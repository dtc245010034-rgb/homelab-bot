const { handleWeekly } = require('./bot');

const CHAT_ID = '8915208045';

handleWeekly(CHAT_ID).catch(console.error);
