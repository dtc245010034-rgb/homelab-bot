const axios = require('axios');
const xml2js = require('xml2js');
const parser = new xml2js.Parser({ explicitArray: false });
const feeds = [
  { name: 'CafeBiz', url: 'https://cafebiz.vn/rss/khoi-cong-nghe-doi-moi-sang-tao.rss' },
  { name: 'VnEconomy', url: 'https://vneconomy.vn/startup.rss' },
];
(async () => {
  for (const feed of feeds) {
    try {
      const { data } = await axios.get(feed.url, { timeout: 8000, headers: {'User-Agent':'Mozilla/5.0'} });
      const result = await parser.parseStringPromise(data);
      const items = result.rss?.channel?.item || [];
      const list = Array.isArray(items) ? items : [items];
      console.log(feed.name + ' — ' + list.length + ' items');
      list.slice(0,2).forEach(i => console.log('  title:', JSON.stringify(i.title)));
    } catch(e) {
      console.log(feed.name + ' — ERROR:', e.message);
    }
  }
})();
