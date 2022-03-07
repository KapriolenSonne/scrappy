require('dotenv').config();
const Redis = require("ioredis");
const client = new Redis(process.env.REDIS_URL);

client.on('connect', () => console.log('connected to redis instance'));
client.on('error',(err) => console.log(err));

console.log(process.env.REDIS_URL);