require('dotenv').config();
require('util').inspect.defaultOptions.depth = null;
const Redis = require("redis");
const puppeteer = require('puppeteer');
const axios = require('axios');
const querystring = require('querystring');
const { Cluster } = require('puppeteer-cluster');

(async () => {
    console.time('Complete Runtime');
    const client = Redis.createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.log('Redis Client Error', err));
    await client.connect();
    var alreadyAcceptedCookies = false;
    var switchedToRelative = false;

    client.on('connect', () => console.log('Connected to REDIS instance'));
    
    let participants = await client.SMEMBERS('users').catch(err => console.log(err));
    const dashboardLinkKeys = participants.map(username => `${username}_dashboard`);
    const dashboardLinks = await client.mGet(dashboardLinkKeys);
    const dashboardEntries = dashboardLinks.map((entry, index) => ({ link: entry, username: participants[index] }));
    console.log(dashboardEntries);
    console.log('Fetch participants...');
    console.log('Fetched ' + dashboardLinks.length + ' entries');

    console.log('initiate cluster');

    const cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_PAGE,
      maxConcurrency: 5,
      puppeteerOptions: {
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
        monitor: false,
        retryLimit: 1,
        workerCreationDelay: 100,
      },
    });

    cluster.on("taskerror", (err, data) => {
      console.log(`Error crawling ${data}: ${err.message}`);
    });

    let finalResult = {};

    await cluster.task(async ({ page, data: url }) => {
      let profileData = {};
      const { username } = dashboardEntries.find(entry => entry.link === url);
      console.log('Scrape: ' + username);
      await page.setViewport({ width: 375, height: 667 });
      await page.goto(url, { 'waitUntil' : 'networkidle2' });
      await new Promise(resolve => setTimeout(resolve, 2000));
      // cookies dialog handling
      try {
        await page.waitForSelector('.cookie-control__button--filled', { timeout: 2000 });
        await page.click('.cookie-control__button--filled');
        alreadyAcceptedCookies = true;
      } catch {
        alreadyAcceptedCookies = true;
      }
      // switch to relative performance display
      try {
        await page.waitForSelector('.absolute-return_pill', { timeout: 1000 });
        await page.click('.absolute-return_pill');
        switchedToRelative = true;
      } catch {
        switchedToRelative = true;
      }

      const data = await page.evaluate(() => {
        let intradayPerformance = document.querySelector('.dashboard-performance-overview__relative-return');
        //const absolutePL = document.querySelector('.return-splitdown__row > .relative-return').innerText.replace(/\s+/g, '').replace(/[^0-9.-]+/g,"");

      if (intradayPerformance == null) {
        document.querySelector('.dashboard-performance-overview__inner-container').click();
      } 

      intradayPerformance = document.querySelector('.dashboard-performance-overview__relative-return')?.innerText;

      const totalPerformance = document.querySelector('.total-return__splitdown .return-row__absolute-return .absolute-return')?.innerText.replace(/\s+/g, '').replace(/[^0-9.-]+/g,"");
      const positions = document.querySelectorAll('.position-row');
      const securityCards = document.querySelector('.dashboard-positions__table_mobile').querySelectorAll('.security-card__wrapper');
      const total = document.querySelector('.dashboard-performance-overview__total > span')?.textContent;
      const performanceSummary = document.querySelectorAll('.return-splitdown__row');
      const absolutePL = document.querySelector('.return-splitdown__row > .relative-return').innerText.replace(/\s+/g, '').replace(/[^0-9.-]+/g,"");
      const totalInvested = performanceSummary[4].querySelector('.absolute-return > span:last-of-type')?.textContent;
      const totalDividends = performanceSummary[1].querySelector('.absolute-return > span:last-of-type')?.textContent;
      const parsedPositions = [];
      let cash = 0;

      for (const [index, entry] of positions.entries()) {
          const position = {};
          const name = entry.querySelector('.name-col > .position-name')?.textContent;
          const performance = entry.querySelector('.row .relative-return')?.textContent
          const units = entry.querySelector('.position__units-amount')?.textContent;
          const isCashPosition = entry.querySelector('.name-col > .name-col__image')?.dataset?.src.includes('cash') && units == '';
          const ISIN = isCashPosition ? null : securityCards[index]?.href.match(/([A-Z,0-9])\w+/g)[0];
          const value = entry.querySelector('.position-value')?.textContent;
          
          position.name = isCashPosition ? 'Cash' : name?.replace(/\s+/g, '');
          position.units = units !== '' ? parseFloat(units?.replace(/\s+/g, '')) : null;
          position.value = parseFloat(value?.replace(/\s+/g, '').replace(/[^0-9.-]+/g,""));
          position.performance = parseFloat(performance?.replace(/\s+/g, '').replace(/[^0-9.-]+/g,""));
          position.ISIN = ISIN;

          if (isCashPosition) {
            cash += parseFloat(position.value);
          }
          if (name) {
            parsedPositions.push(position);
          }
      }

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
          absolutePerformance: parseFloat(totalPerformance),
          relativePerformance: parseFloat(absolutePL),
          intradayPerformance: intradayPerformance ? parseFloat(intradayPerformance.replace('%', '')) : null,
        },
      }
      });
      try {
        await page.goto(`https://app.getquin.com/u/${username}`, { 'waitUntil' : 'networkidle0' });
        await page.waitForSelector('.profile-avatar__img', { timeout: 2000 });

        profileData = await page.evaluate(() => {
            const avatar = document.querySelector('.profile-avatar__img').src;
            const hasNoAvatar = document.querySelector('.profile-info > .profile-avatar_empty');

            return {
                avatar: hasNoAvatar ? false : avatar,
            }
        }).catch((err) => console.log(err));
      } catch(err) {
        console.log(err);
      }

      const participantData = {
        ...data,
        profileData: {
          ...profileData,
          username,
          dashboardLink,
        }
      };
      console.log('[' + username + ']');
      console.log(participantData);

      finalResult = {
        ...finalResult,
        [username]: JSON.stringify(participantData)
      }
    });

  for (dashboardLink of dashboardLinks) {
    cluster.queue(dashboardLink);
  }
  console.log(finalResult);
  await cluster.idle();
  await client.mSet(finalResult);
  console.timeEnd('Complete Runtime');
  
  await axios
  .get(`https://kapriolen.capital/api/revalidate?secret=${process.env.REVALIDATE_SECRET}`, querystring.stringify({ secret: process.env.REVALIDATE_SECRET }))
  .then(res => {
    console.log(`Cache purged`)
  })
  .catch((error) => {
    console.log('Could not purge cache');
  });
  client.quit();
  await cluster.close();
  console.log
  //process.exit(1);
})();
