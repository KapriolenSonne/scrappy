require('dotenv').config();
require('util').inspect.defaultOptions.depth = null;
const Redis = require("redis");
const axios = require('axios');
const querystring = require('querystring');

const getItemType = (item) => {
    if (item.type === 'Base Grade Container') return 'Container';
    return item.tags.find(tag => tag.category === 'Weapon') ? 'Weapon' : 'Other';
};

(async () => {
    let result = {};
    let cases = 0;
    await axios
    .get('https://steamcommunity.com/inventory/76561198080381484/730/2?l=english&count=5000')
    .then(res => {
        if (res.data.success === 1) {
            console.log(res.data.total_inventory_count, res.data.descriptions.length);
            for (const item of res.data.descriptions) {
                if (item.marketable === 1 || item.market_name === 'Storage Unit') {
                    if (item.market_name === 'Storage Unit') {
                        const itemAmount = item.descriptions.find(description => description.value.includes('Number of Items')).value.split(': ')[1];
                        let regex = /Name Tag: ''[^']*''/i;
                        const storageUnitLabel = item.fraudwarnings.find(warning => regex.test(warning));
                        console.log({
                            name: storageUnitLabel.substring(12,storageUnitLabel.length - 7),
                            amount: parseInt(itemAmount), 
                        });
                        continue;
                    }
                    
                    result[item.market_name] = { 
                        count: (result[item.market_name] ? result[item.market_name].count : 0) + res.data.assets.filter(asset => asset.classid === item.classid).length,
                        urlEncodedHash: encodeURIComponent(item.market_name), 
                        condition: item.tags.find(tag => tag.category === 'Exterior')?.localized_tag_name || null,
                        type: getItemType(item),
                    };

                    if (item.type === 'Base Grade Container') {
                        console.log({
                            name: item.market_name,
                            amount: res.data.assets.filter(asset => asset.classid === item.classid).length, 
                        });
                        cases = cases + 1;
                    }
                }
            }
        }
        if (res.data.total_inventory_count > 5000) {
            // recursive call
        }
    })
    .catch((error) => {
        console.log(error);
    });
    console.log(result, Object.keys(result).length);
    console.log(cases);
    process.exit(1);
})();
