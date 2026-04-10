sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast"
], function (Controller, JSONModel, MessageToast) {
  "use strict";

  function md2html(text, refs) {
    var body = text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/^## (.+)$/gm, "<strong>$1</strong>")
      .replace(/^### (.+)$/gm, "<strong>$1</strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/^- (.+)$/gm, "• $1")
      .replace(/\n/g, "<br/>");

    if (refs && refs.length > 0) {
      var tags = refs.map(function (r) {
        return "<span style='display:inline-block;background:#e8f0fb;color:#0a6ed1;" +
          "border:1px solid #c8d8f5;border-radius:4px;padding:2px 8px;" +
          "margin:2px 4px 2px 0;font-size:12px'>📄 " + r.title + "</span>";
      }).join("");
      body += "<br/><br/><span style='font-size:12px;color:#6c757d'>参考文章：</span>" + tags;
    }
    return body;
  }

  return Controller.extend("onboarding.kb.chat.controller.Chat", {

    onInit: function () {
      // 初始化 chat model
      var oModel = new JSONModel({
        messages: [],
        sessions: [],
        currentSessionId: null,
        inputText: "",
        busy: false
      });
      this.getView().setModel(oModel, "chat");

      // 启动后直接显示聊天页（第二个 page）
      var oApp = this.byId("chatApp");
      var oChatPage = this.byId("chatPage");
      if (oApp && oChatPage) {
        oApp.to(oChatPage);
      }

      // Ctrl+Enter 发送
      var oArea = this.byId("inputArea");
      if (oArea) {
        oArea.addEventDelegate({
          onkeydown: function (oEvent) {
            if (oEvent.ctrlKey && oEvent.key === "Enter") {
              this.onSend();
            }
          }.bind(this)
        });
      }
    },

    // ── 汉堡菜单：切换到侧边栏 ──────────────────────────
    onToggleSidebar: function () {
      var oApp = this.byId("chatApp");
      var oMaster = this.byId("masterPage");
      if (oApp && oMaster) {
        oApp.to(oMaster);
      }
    },

    // ── 快捷问题 ─────────────────────────────────────────
    onQuickAsk: function (oEvent) {
      this._getChatModel().setProperty("/inputText", oEvent.getSource().getText());
      this.onSend();
    },

    // ── 新建会话 ─────────────────────────────────────────
    onNewSession: function () {
      var oModel = this._getChatModel();
      oModel.setProperty("/currentSessionId", null);
      oModel.setProperty("/messages", []);
      oModel.setProperty("/inputText", "");
      this.byId("sessionList").removeSelections(true);
      // 切回聊天页
      this.byId("chatApp").to(this.byId("chatPage"));
    },

    // ── 切换会话 ─────────────────────────────────────────
    onSessionSelect: function (oEvent) {
      var oCtx = oEvent.getParameter("listItem").getBindingContext("chat");
      var oModel = this._getChatModel();
      oModel.setProperty("/currentSessionId", oCtx.getProperty("id"));
      oModel.setProperty("/messages", []);
      // 切回聊天页
      this.byId("chatApp").to(this.byId("chatPage"));
      MessageToast.show("已切换会话，继续提问吧");
    },

    // ── 发送消息 ─────────────────────────────────────────
    onSend: function () {
      var oModel = this._getChatModel();
      if (oModel.getProperty("/busy")) return;

      var sQuestion = (oModel.getProperty("/inputText") || "").trim();
      if (!sQuestion) return;

      this._appendMessage({ role: "user", text: sQuestion, html: "" });
      oModel.setProperty("/inputText", "");
      this._appendMessage({ role: "typing" });
      oModel.setProperty("/busy", true);
      this._scrollToBottom();

      var oBody = { question: sQuestion };
      var sSessionId = oModel.getProperty("/currentSessionId");
      if (sSessionId) oBody.sessionId = sSessionId;

      fetch("/api/askQuestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(oBody)
      })
        .then(function (res) {
          if (!res.ok) {
            return res.json().then(function (e) {
              throw new Error((e.error && e.error.message) || "HTTP " + res.status);
            });
          }
          return res.json();
        })
        .then(function (data) {
          var oVal    = data.value || data;
          var sAnswer = oVal.answer || "抱歉，未能获取到回答。";
          var aRefs   = oVal.referencedArticles || [];
          var sMsgId  = oVal.messageId;
          var sSessId = oVal.sessionId;

          oModel.setProperty("/currentSessionId", sSessId);
          this._removeTyping();
          this._appendMessage({
            role: "assistant",
            html: md2html(sAnswer, aRefs),
            messageId: sMsgId,
            rated: false
          });
          this._upsertSession(sSessId, sQuestion);
          this._scrollToBottom();
        }.bind(this))
        .catch(function (err) {
          this._removeTyping();
          this._appendMessage({
            role: "assistant",
            html: "<span style='color:var(--sapNegativeTextColor)'>❌ 出错了：" +
              err.message.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</span>"
          });
          this._scrollToBottom();
        }.bind(this))
        .finally(function () {
          oModel.setProperty("/busy", false);
        }.bind(this));
    },

    // ── 评分 ─────────────────────────────────────────────
    onRate: function (oEvent) {
      var nScore = oEvent.getParameter("value");
      var oCtx   = oEvent.getSource().getBindingContext("chat");
      var sMsgId = oCtx.getProperty("messageId");

      fetch("/api/rateAnswer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: sMsgId, rating: nScore })
      }).then(function () {
        this._getChatModel().setProperty(oCtx.getPath() + "/rated", true);
        MessageToast.show("感谢你的反馈！");
      }.bind(this)).catch(function () {
        MessageToast.show("评分提交失败，请稍后重试");
      });
    },

    // ── 内部工具 ─────────────────────────────────────────
    _getChatModel: function () {
      return this.getView().getModel("chat");
    },

    _appendMessage: function (oMsg) {
      var oModel = this._getChatModel();
      var aMsgs  = oModel.getProperty("/messages").slice();
      aMsgs.push(oMsg);
      oModel.setProperty("/messages", aMsgs);
    },

    _removeTyping: function () {
      var oModel = this._getChatModel();
      oModel.setProperty("/messages",
        oModel.getProperty("/messages").filter(function (m) { return m.role !== "typing"; })
      );
    },

    _upsertSession: function (sId, sTitle) {
      var oModel    = this._getChatModel();
      var aSessions = oModel.getProperty("/sessions").slice();
      if (!aSessions.some(function (s) { return s.id === sId; })) {
        aSessions.unshift({
          id: sId,
          title: sTitle.substring(0, 30),
          createdAt: new Date().toLocaleString("zh-CN", { hour12: false })
        });
        oModel.setProperty("/sessions", aSessions);
      }
    },

    _scrollToBottom: function () {
      var that = this;
      setTimeout(function () {
        var oPage = that.byId("chatPage");
        if (oPage) oPage.scrollTo(999999, 200);
      }, 100);
    }
  });
});
