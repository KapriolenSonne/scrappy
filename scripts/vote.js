const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer
        .launch({headless: true})
        .catch(err => console.log(err));
        console.log('Initiate Browser');
        const page = await browser.newPage();
        await page.setViewport({ width: 1300, height: 800 });
        console.log('Browser started');

        await page.goto(`https://strawpoll.com/polls/LVyKx05vkn0`, { 'waitUntil' : 'networkidle0' });
        await page.waitForSelector('[aria-label="Consent"]');
        await page.waitForSelector('#option-mpnbqzqNMy5');
        await page.evaluate(async () => {
            const delay = ms => new Promise(res => setTimeout(res, ms));
            document.querySelector('[aria-label="Consent"]').click();
            document.getElementById('option-mpnbqzqNMy5').click();
            await delay(1000);
            document.querySelectorAll('button')[4].click();
        }).catch((err) => console.log(err));

        browser.close();
        process.exit(1);
    } catch (err) {
        console.log(err);
    }
})();
