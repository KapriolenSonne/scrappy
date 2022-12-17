require('dotenv').config();
require('util').inspect.defaultOptions.depth = null;
const puppeteer = require('puppeteer');
const axios = require('axios');
const querystring = require('querystring');

(async () => {
    const browser = await puppeteer.launch({
        headless: process.env.ENVIRONMENT !== 'dev',
        args: [
          '--disable-notifications',
          '--disable-client-side-phishing-detection',
          '--no-default-browser-check',
          '--disable-print-preview',
          '--disable-speech-api',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-gpu'
        ],
        userDataDir: './cache',
    });

    const COUNTRY_CODES = ['ja','en','de','fr','it','es','pt','ko'];
    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });

    let result = {};

    for (const countryCode of COUNTRY_CODES) {
        await page.goto(`https://www.db.yugioh-card.com/yugiohdb/card_list.action?request_locale=${countryCode}`, { 'waitUntil' : 'networkidle2', timeout: 0 });
        const data = await page.evaluate(async (countryCode) => {
            let cardSets = {};
            // first is product 2nd is perk bundles
            const tabAccessors = ['.tablink li:nth-of-type(2)', '.tablink li:nth-of-type(3)'];
            
            // click each tab
            for (const tab of tabAccessors) {
                document.querySelector(tab).click();
                const lists = document.querySelectorAll('.pac_set');
                // visit each list
                lists.forEach(list => {
                    const category = list.querySelector('.list_title > span')?.innerText;

                    list.querySelectorAll('.pack').forEach(pack => {
                        const setName = pack.querySelector('p strong')?.innerText;
                        const releaseYear = pack.closest('.toggle').previousSibling.previousSibling.innerText;
                        cardSets[setName] = {
                            url: pack.querySelector('.link_value').value,
                            releaseYear: parseInt(releaseYear),
                            category,
                            countryCode,
                        }
                    });
                });
            }

            return cardSets;
        }, countryCode);
        result[countryCode] = { ...data };
    }

    console.log(result);
})();
