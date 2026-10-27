const exporters = require('../services/exporters');

function createStatsController({ stats }) {
  return {
    index(req, res) {
      res.render('stats/index', { title: 'Statystyki', ranking: stats.ranking(req.user), trend: stats.trend(req.user), signed: exporters.signed });
    },
    rankingCsv(req, res) {
      res.attachment('ranking-obiektow.csv');
      res.type('text/csv; charset=utf-8').send(exporters.rankingCsv(stats.ranking(req.user)));
    },
    trendCsv(req, res) {
      res.attachment('trend-kwartalny.csv');
      res.type('text/csv; charset=utf-8').send(exporters.trendCsv(stats.trend(req.user)));
    },
  };
}

module.exports = { createStatsController };
