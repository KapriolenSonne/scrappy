require('dotenv').config();
require('util').inspect.defaultOptions.depth = null;
const axios = require('axios');
const querystring = require('querystring');

const API_BASE_URL = 'https://data.lemon.markets/v1/';

