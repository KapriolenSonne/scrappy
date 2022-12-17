require('dotenv').config();
require('util').inspect.defaultOptions.depth = null;
const puppeteer = require('puppeteer');
const axios = require('axios');
const querystring = require('querystring');
const Gmail = require('../Services/Gmail/Gmail');
const { GraphQLClient, request, gql } = require('graphql-request');

const username = process.env.BEATSTARS_USERNAME;
const password = process.env.BEATSTARS_PASSWORD;

const BEATSTARS_EMAIL = 'noreply@beatstars.com';
const BEATSTARS_MFA_EMAIL_SUBJECT = 'Beatstars Verification Code:';
const user = process.env.BEATSTARS_USER;

const URLS = {
    LOGIN: 'https://oauth.beatstars.com/verify',
    TOKEN: 'https://core.prod.beatstars.net/auth/oauth/token',
    MFA: 'https://core.prod.beatstars.net/auth/graphql',
};


const bsGraphQLClient = new GraphQLClient(URLS.MFA);

let mfaOpen = false;

function transformRequestPostData(postData) {
    let result = {};
    const chunkedData = postData.split('&');

    for (const chunkProperty of chunkedData) {
        const entry = chunkProperty.split('=');
        result[entry[0]] = decodeURI(entry[1]);
    }

    return result;
}

async function runLoginFlow (page) {
    const emailInput = await page.$('#oath-email');
    await emailInput.focus();
    await page.keyboard.type(username);
    const submitBtn = await page.$('#btn-submit-oath');
    await submitBtn.click();
    await page.waitForSelector('#userPassword')
    const passwordInput = await page.$('#userPassword');
    await passwordInput.focus();
    await page.keyboard.type(password);
    const submitBtnFinal = await page.$('#btn-submit-oath');
    await submitBtnFinal.click();

    try {
        const mfaDialog = await page.waitForSelector('.dialog-content-wrapper', { timeout: 3000 });

        if (mfaDialog) {
            const mfaPin = await getMfaPin();
            const splittedPin = mfaPin.split('');
            const firstPinInput = await page.$('.dialog-content-wrapper input:nth-of-type(3)');
            await firstPinInput.focus();
            await page.keyboard.type(splittedPin[0]);
            const secondPinInput = await page.$('.dialog-content-wrapper input:nth-of-type(4)');
            await secondPinInput.focus();
            await page.keyboard.type(splittedPin[1]);
            const thirdPinInput = await page.$('.dialog-content-wrapper input:nth-of-type(5)');
            await thirdPinInput.focus();
            await page.keyboard.type(splittedPin[2]);
            const fourthPinInput = await page.$('.dialog-content-wrapper input:nth-of-type(6)');
            await fourthPinInput.focus();
            await page.keyboard.type(splittedPin[3]);
        }
    } catch {
        console.log('No MFA dialog detected');
    }
}

async function getMfaPin() {
    console.log('Fetch MFA pin');
    const result = await Gmail
        .authorize()
        .then(auth => Gmail.getLastMessageByPattern(auth, { from: BEATSTARS_EMAIL, subject: BEATSTARS_MFA_EMAIL_SUBJECT }))
        .then(message => message.payload.headers.find(header => header.name === 'Subject').value.split(': ')[1])
        .catch(error => console.log(error));
    return result;
}

async function requestToken(tokenCredentials) {
    const token = await axios
    .post(URLS.TOKEN, querystring.stringify(tokenCredentials))
    .then(res => {
        const { data } = res;
        console.log(data);
        return data;
    })
    .catch(async (error) => {
        if (error.response.data.code === 'MFA_VERIFICATION_ACTION') {
            console.log('Detected MFA requirement');
            return;
        }
        console.log(error.message);
        console.log('Token request failed');
    });
    return token;
}

async function handleMFA(){
    const mutation = gql`
        mutation verifyMfa($verifyMfaRequest: VerifyMfaRequestInput!) {
            verifyMfa(verifyMfaRequest: $verifyMfaRequest)
        }
    `;
    const variables = { 
        verifyMfaRequest: {
            identifier: user,
            pin: '5236',
        }
    }
    const data = await bsGraphQLClient
        .request(mutation, variables)
        .catch(async (error) => {
            const { errors } = error.response;
            const invalidPinErrorFound = errors.find(error => error.message.includes('Invalid entered pin code'))
            
            if (invalidPinErrorFound) {
                console.log('Invalid MFA Pin used');
                console.log('Fetch new token from email inbox...');
                await getMfaPin();
            }
        });
    
        if (data?.verifyMfa === 'OK') {
            console.log('Successfully applied MFA Pin');
            return;
        }
}

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

    const page = await browser.newPage();
    await page.goto(URLS.LOGIN, { 'waitUntil' : 'networkidle2', timeout: 0 });
    var tokenCredentials = null;

    page.on('request', async (request) => {
        if (request.url().endsWith("/auth/oauth/token") 
            && request.postData()?.includes('client_id')
            && request.postData()?.includes('grant_type=password') 
            && typeof request.postData() !== 'undefined') {
            tokenCredentials = transformRequestPostData(request.postData());
            console.log('Detected credentials');
            console.log('Request Token');
            console.log(tokenCredentials);

            const token = await requestToken(tokenCredentials);
            //.then(() => process.exit(1));
        }
    });

    console.log('Run login flow');
    await runLoginFlow(page)
    //.then(() => browser.close());
    // save the tokens from the token endpoint and cache the refresh rate
})();
