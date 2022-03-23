require('dotenv').config();
require('util').inspect.defaultOptions.depth = null;
const Redis = require("redis");
const puppeteer = require('puppeteer');
const axios = require('axios');
const querystring = require('querystring');


(async () => {
    const client = Redis.createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.log('Redis Client Error', err));
    await client.connect();
    let alreadyAcceptedCookies = false;
    let finalResult = {};

    client.on('connect', () => console.log('Connected to REDIS instance'));
    
    let participants = await client.SMEMBERS('users')
    .catch(err => console.log(err));

    console.log('Fetch participants...');
    console.log('Fetched ' + participants.length + ' entries');
    console.log(participants);

    const browser = await puppeteer
    .launch({
      headless: true,
      args: ['--disable-notifications','--disable-client-side-phishing-detection','--no-default-browser-check','--disable-print-preview','--disable-speech-api','--no-sandbox'],
      userDataDir: './cache'})
    .catch(err => console.log(err));
    console.log('Initiate Browser');
    const page = await browser.newPage();
    await page.setViewport({ width: 1300, height: 800 });
    console.log('Browser started');

    for (const username of participants) {
      const dashboardLink = await client.HGET(`user:${username}`, 'dashboardLink');
      console.log('Scrape: ' + username);
      await page.goto(dashboardLink, { 'waitUntil' : 'domcontentloaded' });

      try {
        await page.waitForSelector('.cookie-control__button--filled');
        await page.click('.cookie-control__button--filled');
        alreadyAcceptedCookies = true;
      } catch {
        alreadyAcceptedCookies = true;
      }

      const data = await page.evaluate(() => {
        const positions = document.querySelectorAll('.position-row');
        const total = document.querySelector('.dashboard-performance-overview__total > span')?.textContent;
        const totalPerformance = document.querySelector('.total-return__relative-return > div')?.textContent;
        const absolutePL = parseFloat(document.querySelectorAll('.return-row__absolute-return > span > span')[0].innerText.replace(/\s+/g, '').replace(/[^0-9.-]+/g,""));
        const performanceSummary = document.querySelectorAll('.return-splitdown__row');
        // const totalInvested = performanceSummary[4].querySelector('.absolute-return > span:last-of-type')?.textContent;
        const totalDividends = performanceSummary[1].querySelector('.absolute-return > span:last-of-type')?.textContent;
        const parsedPositions = [];
        let cash = 0;

        // total performance

        for (const entry of positions) {
            const position = {};
            const name = entry.querySelector('.name-col > .position-name')?.textContent;
            const performance = entry.querySelector('.row .relative-return')?.textContent
            const units = entry.querySelector('.position__units-amount')?.textContent;
            const isCashPosition = entry.querySelector('.name-col > .name-col__image')?.dataset?.src.includes('cash') && units == '';
            const value = entry.querySelector('.position-value')?.textContent;
            
            position.name = isCashPosition ? 'Cash' : name?.replace(/\s+/g, '');
            position.units = units !== '' ? parseFloat(units?.replace(/\s+/g, '')) : null;
            position.value = parseFloat(value?.replace(/\s+/g, '').replace(/[^0-9.-]+/g,""));
            position.performance = parseFloat(performance?.replace(/\s+/g, '').replace(/[^0-9.-]+/g,""));

            if (isCashPosition) {
              cash += parseFloat(position.value);
            }
            if (name) {
              parsedPositions.push(position);
            }
        }
        console.log(parsedPositions);
        // highest to lowest
        const performanceWeightedPositions = parsedPositions.filter(entry => entry.units !== null).sort((entryA, entryB) => {
          return entryB.performance - entryA.performance;
        });
        
        const calcTotalInvestment = () => {
          let result = parseFloat(total.replace(/\s+/g, '').replace(/[^0-9.-]+/g,""));

          if (absolutePL > 0) {
            result = result - Math.abs(absolutePL);
          } else {
            result = result + Math.abs(absolutePL);
          }

          result = result - cash;

          return parseFloat(result).toFixed(2);
        }

        return {
            positions: {
              entries: parsedPositions,
              count: Object.keys(parsedPositions).length,
              stats: {
                biggestGainer: performanceWeightedPositions.length > 0 ? performanceWeightedPositions[0] : {},
                biggestLoser: performanceWeightedPositions.length > 0 ? performanceWeightedPositions[performanceWeightedPositions.length-1] : {},
              }
            },
            cash: {
              amount: cash,
              percentageOfPortfolio: cash > 0 ? parseFloat((cash/ total.replace(/\s+/g, '').replace(/[^0-9.-]+/g,"")) * 100).toFixed(2) : 0,
            },
            total: {
              value: total ? parseFloat(total.replace(/\s+/g, '').replace(/[^0-9.-]+/g,"")) : null,
              invested: calcTotalInvestment(),
              dividends: totalDividends ? parseFloat(totalDividends.replace(/[^0-9.-]+/g,"")) : null,
              absolutePerformance: absolutePL,
              relativePerformance: totalPerformance ? parseFloat(totalPerformance.replace(/\s+/g, '').replace(/[^0-9.-]+/g,"")) : null
            },
        }
      }).catch((error) => console.log(error));

      await page.goto(`https://app.getquin.com/u/${username}`, { 'waitUntil' : 'networkidle0' });
      await page.waitForSelector('.profile-avatar__img');
      const profileData = await page.evaluate(() => {
          const avatar = document.querySelector('.profile-avatar__img').src;
          const hasNoAvatar = document.querySelector('.profile-info > .profile-avatar_empty');

          return {
              avatar: hasNoAvatar ? false : avatar,
          }
      }).catch((err) => console.log(err));

      const participantData = {
          ...data,
          profileData: {
            ...profileData,
            username,
            dashboardLink,
          }
      }

      finalResult = {
        ...finalResult,
        [username]: JSON.stringify(participantData)
      }

      await client.mSet(finalResult)

      console.log(participantData);
    }

    await axios
    .get(`https://kapriolen.capital/api/revalidate?secret=${process.env.REVALIDATE_SECRET}`, querystring.stringify({ secret: process.env.REVALIDATE_SECRET }))
    .then(res => {
      console.log(`Cache purged`)
    })
    .catch((error) => {
      console.log('Could not purge cache');
    });
    client.quit();
    browser.close();
    process.exit(1);
})();
