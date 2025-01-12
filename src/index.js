const express = require('express');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const Alexa = require("ask-sdk-core");
const http = require("node:http");
const {get} = require("node:https");
const app = express();
const skillBuilder = Alexa.SkillBuilders.custom();
const siteId = fs.readFileSync("../siteId", "utf-8");
const axios = require("axios");
const {PythonShell} = require("python-shell");
const fs = require("node:fs");
const AlexaClientID = fs.readFileSync("../AlexaClientId", "utf8");
const AlexaClientSecret = fs.readFileSync("../AlexaClientSecret", "utf8");
let targets = [];
let tokenRequestDate;
let apiToken;
const jsdom = require("jsdom");
let newestData = {};


async function fetchSolarEdgeData() {
    if(!tokenRequestDate || tokenRequestDate.getTime() < new Date().getTime() || !apiToken) {
        apiToken = await getAccessToken();
        tokenRequestDate = new Date();
        tokenRequestDate.setSeconds(tokenRequestDate.getSeconds() + apiToken.expires_in);
    }
    let resultForPowerFlow = await PythonShell.run('request.py', {
        mode: 'text',
        pythonOptions: ['-u'],
        cwd: "../",
        args: ['https://api.solaredge.com/solaredge-apigw/api/site/1402550/currentPowerFlow.json?getLoadType=true']
    }, function (err, results) {
        if (err)
            throw err;
    });
    resultForPowerFlow = JSON.parse(resultForPowerFlow[0])["siteCurrentPowerFlow"];
    let resultForFieldOverview = await PythonShell.run('request.py', {
        mode: 'text',
        pythonOptions: ['-u'],
        cwd: "../",
        args: ['https://api.solaredge.com/solaredge-apigw/api/field/1402550/fieldOverview']
    }, function (err, results) {
        if (err)
            throw err;
    });
    resultForFieldOverview = new jsdom.JSDOM(resultForFieldOverview);
    const powerFlowUnit = resultForPowerFlow["unit"];
    const energyToday = resultForFieldOverview.window.document.getElementsByTagName("FieldOverviewData")[0].getElementsByTagName("lastDayData")[0].getElementsByTagName("energy")[0].getAttribute("localized");
    const currentPower = resultForPowerFlow["PV"]["currentPower"] + " " + powerFlowUnit;
    const currentUsage = resultForPowerFlow["LOAD"]["currentPower"] + " " + powerFlowUnit;
    let currentFeed = resultForPowerFlow["GRID"]["currentPower"] + " " + powerFlowUnit;
    let currentFeedColor;

    for(let connection in resultForPowerFlow["connections"]) {
        connection = resultForPowerFlow["connections"][connection];
        if(connection["from"] === "GRID" || connection["to"] === "GRID") {
            if(connection["from"] === "GRID") {
                currentFeedColor = "red";
            } else {
                currentFeedColor = "#011f09";
            }
            break;
        }
    }
    newestData = {
        "energyNow": currentPower,
        "energyToday": energyToday,
        "energyUsage": currentUsage,
        "energyFeed": currentFeed,
        "energyFeedColor": currentFeedColor
    }
    await updateDatastore(apiToken, [
        {
            "type": "PUT_OBJECT",
            "namespace": "solarEdgeAPI",
            "key": "solarEdgeData",
            "content": {
                "energyNow": currentPower,
                "energyToday": energyToday,
                "energyUsage": currentUsage,
                "energyFeed": currentFeed,
                "energyFeedColor": currentFeedColor
            }
        }
    ], {
        "type": "DEVICES",
        "items": targets
    });
}

function getAccessToken() {
    let config = {
        method: "post",
        url: "https://api.amazon.com/auth/o2/token",
        timeout: 3000,
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            charset: "utf-8",
        },
        params: {
            grant_type: "client_credentials",
            client_id: AlexaClientID,
            client_secret: AlexaClientSecret,
            scope: "alexa::datastore"
        }
    };

    return axios(config)
        .then(function (response) {
            return response.data;
        })
        .catch(function (error) {
            console.log(error)
        });
}

const APLEventHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === "Alexa.Presentation.APL.UserEvent";
    },
    async handle(handlerInput) {
        const eventType = handlerInput.requestEnvelope.request.arguments[0];

        switch(eventType) {
            case "refresh": {
                await fetchSolarEdgeData();
                break;
            }
            case "clickedEnergyNow": {
                await fetchSolarEdgeData();
                return getCurrentlyProduced(handlerInput, false);
            }
            case "clickedGetTodayProduced": {
                await fetchSolarEdgeData();
                return getHowMuchProduced(handlerInput, false);
            }
            case "clickedCurrentUsage": {
                await fetchSolarEdgeData();
                return getHowMuchUsageRightNow(handlerInput, false)
            }
            case "clickedHowMuchFeed": {
                await fetchSolarEdgeData();
                try {
                    const result = await requestPromise(`https://monitoringapi.solaredge.com/site/${siteId}/currentPowerFlow?api_key=${apiKey}&format=json`);
                    const jsonData = JSON.parse(result);
                    const power = jsonData["siteCurrentPowerFlow"]["GRID"]["currentPower"];
                    let speechText;
                    if(power === 0 || power === 0.0) {
                        speechText = `Wir erzeugen gerade genau so viel wie wir verbrauchen`;
                    } else if(power > 0) {
                        speechText = `Wir beziehen gerade ${power} kW`;
                    }else {
                        speechText = `Wir speisen gerade ${power} kW ein`;
                    }
                    return handlerInput.responseBuilder
                        .speak(speechText)
                        .getResponse();
                } catch (error) {
                    console.log(error)
                    return handlerInput.responseBuilder
                        .speak("Ein Fehler ist aufgetreten")
                        .getResponse();
                }
            }
        }

        return handlerInput.responseBuilder.getResponse();
    },
}

async function updateDatastore(token, commands, target) {
    const config = {
        method: "post",
        url: `https://api.eu.amazonalexa.com/v1/datastore/commands`,
        headers: {
            "Content-Type": "application/json",
            Authorization: `${token.token_type} ${token.access_token}`
        },
        data: {
            commands: commands,
            target: target
        }
    };

    return axios(config)
        .then(function (response) {
            console.log(JSON.stringify(response.data));
            return response.data;
        })
        .catch(function (error) {
            console.log(error);
        });
}


setInterval(function() {
    fetchSolarEdgeData();
}, 20000)

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    handle(handlerInput) {
        const speechText = "Willkommen bei Solar Edge. Frag mich zum Beispiel: 'Wie viel Strom haben wir heute produziert?'";

        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .withSimpleCard("Willkommen bei Solar Edge", speechText)
            .getResponse();
    }
};

async function requestPromise(path) {
    return new Promise((resolve, reject) => {
        get(path, (resp) => {
            let data = '';

            resp.on('data', (chunk) => {
                data += chunk;
            });

            resp.on('end', () => {
                resolve(data);
            });

        }).on("error", (error) => {
            reject(error);
        });
    });
}

function getCurrentlyProduced(handlerInput, card) {
    try {
        const speechText = `Gerade produzieren wir ${newestData.energyNow}`;
        if(card) {
            return handlerInput.responseBuilder
                .speak(speechText)
                .withSimpleCard('SolarEdge Energie', speechText)
                .getResponse();
        } else {
            return handlerInput.responseBuilder
                .speak(speechText)
                .getResponse();
        }
    } catch (error) {
        console.log(error)
        return handlerInput.responseBuilder
            .speak("Ein Fehler ist aufgetreten")
            .getResponse();
    }
}

function getHowMuchProduced(handlerInput, card) {
    try {
        const speechText = `Heute wurden ${newestData.energyToday} Wattstunden produziert.`;
        if(card) {
            return handlerInput.responseBuilder
                .speak(speechText)
                .withSimpleCard('SolarEdge Energie', speechText)
                .getResponse();
        } else {
            return handlerInput.responseBuilder
                .speak(speechText)
                .getResponse();
        }
    } catch (error) {
        console.log(error)
        return handlerInput.responseBuilder
            .speak("Ein Fehler ist aufgetreten")
            .getResponse();
    }
}

async function getTotalProduced(handlerInput) {
    try {
        const result = await requestPromise(`https://monitoringapi.solaredge.com/site/${siteId}/overview?api_key=${apiKey}&format=json`);
        const jsonData = JSON.parse(result);
        const energy = jsonData["overview"]["lifeTimeData"]["energy"];
        const revenue = jsonData["overview"]["lifeTimeData"]["revenue"];
        const speechText = `Insgesamt haben wir schon ${energy} Wattstunden produziert und haben dadurch ${revenue} Euro erwirtschaftet`;
        return handlerInput.responseBuilder
            .speak(speechText)
            .withSimpleCard('SolarEdge Energie', speechText)
            .getResponse();
    } catch (error) {
        console.log(error)
        return handlerInput.responseBuilder
            .speak("Ein Fehler ist aufgetreten")
            .getResponse();
    }
}

function getDoWeFeed(handlerInput) {
    try {
        let speechText;
        if(newestData.energyFeedColor === "red") {
            speechText = `Nein, wir speisen gerade nicht ein`;
        } else {
            speechText = `Ja wir speisen gerade ein`;
        }
        return handlerInput.responseBuilder
            .speak(speechText)
            .withSimpleCard('SolarEdge Energie', speechText)
            .getResponse();
    } catch (error) {
        console.log(error)
        return handlerInput.responseBuilder
            .speak("Ein Fehler ist aufgetreten")
            .getResponse();
    }
}

function getHowMuchFeed(handlerInput) {
    try {
        let speechText;
        if(newestData.energyFeedColor === "red") {
            speechText = `Wir speisen gerade nichts ins Netz`;
        } else {
            speechText = `Wir speisen gerade ${newestData.energyFeed} ein`;
        }
        return handlerInput.responseBuilder
            .speak(speechText)
            .withSimpleCard('SolarEdge Energie', speechText)
            .getResponse();
    } catch (error) {
        console.log(error)
        return handlerInput.responseBuilder
            .speak("Ein Fehler ist aufgetreten")
            .getResponse();
    }
}

async function getHowMuchBuy(handlerInput) {
    try {
        let speechText;
        if(newestData.energyFeedColor === "white") {
            speechText = `Wir kaufen gerade keinen Strom`;
        } else {
            speechText = `Wir kaufen gerade ${newestData.energyFeed} ein`;
        }
        return handlerInput.responseBuilder
            .speak(speechText)
            .withSimpleCard('SolarEdge Energie', speechText)
            .getResponse();
    } catch (error) {
        console.log(error)
        return handlerInput.responseBuilder
            .speak("Ein Fehler ist aufgetreten")
            .getResponse();
    }
}

function getHowMuchUsageRightNow(handlerInput, card) {
    try {
        if(card) {
            return handlerInput.responseBuilder
                .speak("Unser Enegievebrauch ist gerade " + newestData.energyUsage + " kW")
                .withSimpleCard('SolarEdge Energie', "Unser Enegievebrauch ist gerade " + newestData.energyUsage + " kW")
                .getResponse();
        } else {
            return handlerInput.responseBuilder
                .speak("Unser Enegievebrauch ist gerade " + newestData.energyUsage + " kW")
                .getResponse();
        }
    } catch (error) {
        console.log(error)
        return handlerInput.responseBuilder
            .speak("Ein Fehler ist aufgetreten")
            .getResponse();
    }
}

const HowMuchProducedHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'getproduced';
    },
    async handle(handlerInput) {
        return getHowMuchProduced(handlerInput, true);
    }
}

const HowMuchUsageRightNowHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'howmuchusage';
    },
    async handle(handlerInput) {
        return getHowMuchUsageRightNow(handlerInput, true);
    }
}

const TotalProduced = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'totalproduced';
    },
    async handle(handlerInput) {
        return getTotalProduced(handlerInput);
    }
}

const CurrentlyProduced = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'currentlyproduced';
    },
    async handle(handlerInput) {
        return getCurrentlyProduced(handlerInput, true);
    }
}

const DoWeFeed = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'dowefeed';
    },
    async handle(handlerInput) {
        return getDoWeFeed(handlerInput);
    }
}

const HowMuchFeed = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'howmuchfeed';
    },
    async handle(handlerInput) {
        return getHowMuchFeed(handlerInput);
    }
}

const HowMuchBuy = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'howmuchbuy';
    },
    async handle(handlerInput) {
        return getHowMuchBuy(handlerInput);
    }
}

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speechText = "Frag mich zum Beispiel: 'Wie viel Strom haben wir heute produziert?'";

        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const speechText = 'Auf Wiedersehen';

        return handlerInput.responseBuilder
            .speak(speechText)
            .withShouldEndSession(true)
            .getResponse();
    }
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        // Any clean-up logic goes here.
        return handlerInput.responseBuilder.getResponse();
    }
};

const InstallWidgetRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === "Alexa.DataStore.PackageManager.UsagesInstalled";
    },
    async handle(handlerInput) {
        if(!targets.includes(handlerInput.requestEnvelope.context.System.device.deviceId)) {
            targets.push(handlerInput.requestEnvelope.context.System.device.deviceId)
        }

        await fetchSolarEdgeData();

        return handlerInput.responseBuilder.getResponse();
    }
}

const RemoveWidgetRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === "Alexa.DataStore.PackageManager.UsagesRemoved";
    },
    async handle(handlerInput) {

        return handlerInput.responseBuilder.getResponse();
    }
};

const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`Error handled: ${error.message}`);

        return handlerInput.responseBuilder
            .speak('Tut mir leid. Das habe ich leider nicht verstanden')
            .reprompt('Tut mir leid. Das habe ich leider nicht verstanden')
            .getResponse();
    }
};

skillBuilder.addRequestHandlers(
    LaunchRequestHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler,
    HowMuchProducedHandler,
    TotalProduced,
    CurrentlyProduced,
    DoWeFeed,
    HowMuchFeed,
    HowMuchBuy,
    HowMuchUsageRightNowHandler,
    InstallWidgetRequestHandler,
    RemoveWidgetRequestHandler,
    APLEventHandler

);
skillBuilder.addErrorHandler(ErrorHandler)

function saveTargets() {
    const jsonString = JSON.stringify(targets);
    fs.writeFileSync("../targets.json", jsonString);
}

function loadTargets() {
    try {
        const jsonString = fs.readFileSync("../targets.json", 'utf8');
        targets = JSON.parse(jsonString);
    } catch (error) {
    }
}

process.on('beforeExit', (code) => {
    saveTargets();
});

process.on("SIGINT", (code) => {
    saveTargets();
})


const skill = skillBuilder.create();
const adapter = new ExpressAdapter(skill, true, true);
app.use((req, res, next) => {
    console.log('Incoming request:', req.headers);
    next();
});

app.post('/alexa', adapter.getRequestHandlers());

loadTargets();

fetchSolarEdgeData().then(() => {
    http.createServer(app).listen(8080);
});