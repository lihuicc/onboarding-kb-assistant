sap.ui.define([
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (MessageToast, MessageBox) {
    "use strict";

    return {
        uploadContent: function (oBindingContext) {
            if (!oBindingContext) {
                MessageBox.error("请先打开一篇文章再上传文档。");
                return;
            }

            var oInput = document.createElement("input");
            oInput.type = "file";
            oInput.accept = ".txt";
            oInput.style.display = "none";
            document.body.appendChild(oInput);

            oInput.addEventListener("change", function () {
                var oFile = oInput.files[0];
                if (!oFile) {
                    document.body.removeChild(oInput);
                    return;
                }

                var oReader = new FileReader();
                oReader.onload = function (e) {
                    oBindingContext.setProperty("content", e.target.result).then(function () {
                        MessageToast.show("文档内容已载入，请检查后保存。");
                    }).catch(function (err) {
                        MessageBox.error("写入内容失败：" + (err.message || err));
                    });
                    document.body.removeChild(oInput);
                };
                oReader.onerror = function () {
                    MessageBox.error("文件读取失败，请重试。");
                    document.body.removeChild(oInput);
                };
                oReader.readAsText(oFile, "utf-8");
            });

            oInput.click();
        }
    };
});
