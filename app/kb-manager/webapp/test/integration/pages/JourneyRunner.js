sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"kbmanager/test/integration/pages/KnowledgeArticlesList",
	"kbmanager/test/integration/pages/KnowledgeArticlesObjectPage"
], function (JourneyRunner, KnowledgeArticlesList, KnowledgeArticlesObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('kbmanager') + '/test/flpSandbox.html#kbmanager-tile',
        pages: {
			onTheKnowledgeArticlesList: KnowledgeArticlesList,
			onTheKnowledgeArticlesObjectPage: KnowledgeArticlesObjectPage
        },
        async: true
    });

    return runner;
});

