require('dotenv').config();
require('util').inspect.defaultOptions.depth = null;
const Redis = require("ioredis");
const puppeteer = require('puppeteer');
const client = new Redis(process.env.REDIS_URL);

(async () => {
    let alreadyAcceptedCookies = false;
    let result = {};

    client.on('connect', () => console.log('Connected to REDIS instance'));
    client.on('error', (err) => console.log(err));
    
    let participants = await client.lrange('participants',0,-1)
    .then((result) => result.map(entry => JSON.parse(entry)))
    .catch(err => console.log(err));
    console.log('Fetch participants...')
    console.log('Fetched ' + participants.length + ' entries');
    console.log(participants);
    
    const browser = await puppeteer
    .launch()
    .catch(err => console.log(err));

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    for (const participant of participants) {
      const { username, dashboardLink } = participant;
      console.log('Scrape: ' + username);
      await page.goto(dashboardLink, { 'waitUntil' : 'networkidle0' });

      if (!alreadyAcceptedCookies) {
        await page.waitForSelector('.cookie-control__button--filled');
        await page.click('.cookie-control__button--filled');
        alreadyAcceptedCookies = true;
      }

      const data = await page.evaluate(() => {
        const positions = document.querySelectorAll('.position-row');
        const total = document.querySelector('.dashboard-performance-overview__total > span')?.textContent;
        const totalPerformance = document.querySelector('.total-return__relative-return > div')?.textContent;
        const absolutePL = parseFloat(document.querySelectorAll('.return-row__absolute-return > span > span')[0].innerText.replace(/\s+/g, '').replace(/[^0-9.-]+/g,""));
        const performanceSummary = document.querySelectorAll('.return-splitdown__row');
        const totalInvested = performanceSummary[4].querySelector('.absolute-return > span:last-of-type')?.textContent;
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
              //total performance, position performance, dividends
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
            result = result - absolutePL;
          } else {
            result = result + absolutePL;
          }

          result = result - cash;

          return parseFloat(result).toFixed(2);
        }

        return {
            positions: parsedPositions,
            count: positions.length,
            cash: {
              amount: cash,
              percentageOfPortfolio: cash > 0 ? parseFloat((cash/ total.replace(/\s+/g, '').replace(/[^0-9.-]+/g,"")) * 100).toFixed(2) : 0,
            },
            totalValue: total ? parseFloat(total.replace(/\s+/g, '').replace(/[^0-9.-]+/g,"")) : null,
            totalInvested: calcTotalInvestment(),
            totalDividends: totalDividends ? parseFloat(totalDividends.replace(/[^0-9.-]+/g,"")) : null,
            absolutePL: absolutePL,
            totalRelativePerformance: totalPerformance ? parseFloat(totalPerformance.replace(/\s+/g, '').replace(/[^0-9.-]+/g,"")) : null,
            biggestGainer: performanceWeightedPositions[0],
            biggestLoser: performanceWeightedPositions[performanceWeightedPositions.length-1],
        }
      }).catch((error) => console.log(error));

      await page.goto(`https://app.getquin.com/u/${username}`, { 'waitUntil' : 'networkidle0' });
      await page.waitForSelector('.profile-avatar__img');
      const profileData = await page.evaluate(() => {
          const avatar = document.querySelector('.profile-avatar__img').src;

          return {
              avatar: avatar,
          }
      }).catch(() => console.log("Couldn't fetch profile image"));

      const participantData = {
          ...data,
          profileData
      }
      result = {
        ...result,
        [username]: participantData,
      }
    }
    browser.close();
    console.log(result);
    process.exit(1);
})();
