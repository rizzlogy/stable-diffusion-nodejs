const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const config = require("./config.json");
const cors = require("cors");
const logger = require("morgan");
const chalk = require("chalk");
const bodyParser = require("body-parser");
const { Prodia } = require("prodia.js");
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');

const { generateImage, generateImageSDXL, wait } = Prodia(config.Setup.key);

const app = express();
const PORT = process.env.PORT || 4000;

app.set("json spaces", 2);
app.set("trust proxy", true);
app.enable("trust proxy");
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(swaggerUi.serve);
app.use(cors());

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function runtime(seconds) {
    seconds = Number(seconds);
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const dDisplay = d > 0 ? d + (d === 1 ? " day, " : " days, ") : "";
    const hDisplay = h > 0 ? h + (h === 1 ? " hour, " : " hours, ") : "";
    const mDisplay = m > 0 ? m + (m === 1 ? " minute, " : " minutes, ") : "";
    const sDisplay = s > 0 ? s + (s === 1 ? " second" : " seconds") : "";
    return dDisplay + hDisplay + mDisplay + sDisplay;
}

function status(code) {
    if (code >= 400 && code < 500) return chalk.yellow(code);
    if (code >= 500 && code < 600) return chalk.red(code);
    if (code >= 300 && code < 400) return chalk.cyan(code);
    if (code >= 200 && code < 300) return chalk.green(code);
    return chalk.yellow(code);
}

app.use(
    logger((tokens, req, res) => [
        req.ip,
        tokens.method(req, res),
        tokens.url(req, res),
        status(tokens.status(req, res)),
        `${tokens["response-time"](req, res)} ms`,
        formatBytes(isNaN(tokens.res(req, res, "content-length")) ? 0 : tokens.res(req, res, "content-length")),
    ].join(" | "))
);

app.get("/", (req, res) => {
    swaggerDocument.host = req.get("host");
    swaggerDocument.schemes = ["https"];
    res.send(
        swaggerUi.generateHTML(swaggerDocument, {
            customCss: `.swagger-ui .topbar .download-url-wrapper { display: none } 
                        .swagger-ui .topbar-wrapper img[alt="Stable Diffusion API"], .topbar-wrapper span { visibility: collapse; }
                        .swagger-ui .topbar-wrapper img { content: url("https://fasturl.cloud/content/FastURL_SlimLogoSC.png"); }
                        .swagger-ui .opblock-section-body .parameters-col_description { width: 50px; }
                        .swagger-ui .response-col_links { display: none; }`,
            customfavIcon: "https://fasturl.cloud/content/FastURL_SlimLogoSC.png",
            customSiteTitle: swaggerDocument.info.title,
            customSiteDesc: swaggerDocument.info.description,
        })
    );
});

app.get("/swagger.json", (req, res) => {
    swaggerDocument.host = req.get("host");
    swaggerDocument.schemes = ["https"];
    res.json(swaggerDocument);
});

app.get("/api/v1/models", (req, res) => {
    res.status(200).json({
        Model: {
            default: Object.keys(config.Model.validModelsDefault),
            sdxl: Object.keys(config.Model.validModelsSDXL),
            stylePresets: Object.keys(config.Model.validStylePresets),
        },
        status: 200,
        creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
    });
});

app.get("/api/v1/generateImage", async (req, res) => {
    console.log(chalk.blue("Received request for /api/v1/generateImage"));

    let { prompt, model, typeModel, stylePreset, height, width, negativePrompt, upscale } = req.query;

    console.log(chalk.blue("Incoming parameters:"), {
        prompt,
        negativePrompt,
        model,
        typeModel,
        stylePreset,
        height,
        width,
        upscale,
    });

    if (!prompt || !model || !typeModel) {
        console.log(chalk.yellow("Missing parameters. Please provide prompt, model, and typeModel."));
        return res.status(400).json({
            content: "Missing parameters. Please provide prompt, model, and typeModel.",
            status: 400,
            creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
        });
    }

    const typeModelLowerCase = typeModel.toLowerCase();

    const mappedModel = config.Model[`validModels${typeModelLowerCase === 'sdxl' ? 'SDXL' : 'Default'}`][model];
    const mappedStylePreset = stylePreset ? config.Model.validStylePresets[stylePreset] : null;

    if (
        (typeModelLowerCase === "sdxl" && !mappedModel) ||
        (typeModelLowerCase === "default" && !mappedModel)
    ) {
        const validModels = typeModelLowerCase === "sdxl" ? "SDXL" : "default";
        console.log(chalk.yellow(`Invalid model for ${validModels}. Please choose a valid ${validModels} model. See list of models in '/api/v1/models'.`));
        return res.status(400).json({
            content: `Invalid model for ${validModels}. Please choose a valid ${validModels} model. See list of models in '/api/v1/models'.`,
            status: 400,
            creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
        });
    }

    if (stylePreset && !mappedStylePreset) {
        console.log(chalk.yellow("Invalid style preset. Please choose a valid style preset."));
        return res.status(400).json({
            content: "Invalid style preset. Please choose a valid style preset.",
            status: 400,
            creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
        });
    }

    const validHeight = !isNaN(height) && height > 0 && height <= 1024;
    const validWidth = !isNaN(width) && width > 0 && width <= 1024;

    if (!validHeight || !validWidth) {
        console.log(chalk.yellow("Invalid height or width. Please provide values between 1 and 1024."));
        return res.status(400).json({
            content: "Invalid height or width. Please provide values between 1 and 1024.",
            status: 400,
            creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
        });
    }

    if (upscale && upscale !== "true" && upscale !== "false") {
        console.log(chalk.yellow("Invalid upscale value. Please provide 'true' atau 'false'."));
        return res.status(400).json({
            content: "Invalid upscale value. Please provide 'true' atau 'false'.",
            status: 400,
            creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
        });
    }

    try {
        const generateFunc = typeModelLowerCase === "sdxl" ? generateImageSDXL : generateImage;

        const result = await generateFunc({
            prompt: prompt.trim(),
            model: mappedModel,
            style_preset: mappedStylePreset || "",
            height: parseInt(height),
            width: parseInt(width),
            sampler: "DPM++ 2M Karras",
            seed: -1,
            cfg_scale: 7,
            negative_prompt: negativePrompt ? negativePrompt.trim() : "",
            steps: 20,
            upscale: upscale === "true",
        });

        console.log(chalk.blue('Parameters passed to generateFunc:'), {
            prompt: prompt.trim(),
            negativePrompt: negativePrompt ? negativePrompt.trim() : "",
            model: mappedModel,
            stylePreset: mappedStylePreset || "",
            height,
            width,
            upscale,
        });

        const { status, imageUrl } = await wait(result);

        if (status === "failed") {
            console.log(chalk.red("Stable diffusion failed. Try again later."));
            return res.status(500).json({
                content: "Stable diffusion failed. Try again later.",
                status: 500,
                creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
            });
        }

        const response = await axios.get(imageUrl, { responseType: "arraybuffer" });

        const randomFilename = crypto.randomBytes(15).toString("hex").toUpperCase();

        res.set("Content-Type", "image/png");
        res.set("Content-Disposition", `inline; filename="TextToImage-${randomFilename}.png"`);

        res.send(Buffer.from(response.data, "binary"));
        console.log(chalk.green("Image sent successfully"));
    } catch (e) {
        console.error(chalk.red("Error occurred:"), e.message);

        if (e.response && e.response.data) {
            console.error(chalk.red("Error response data:"), e.response.data);
        }

        return res.status(500).json({
            content: "Internal Server Error",
            status: 500,
            error: e.message,
            creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
        });
    }
});

app.get("/api/v1/styleSheet", (req, res) => {
    res.status(200).json({
        stylePresets: config.Model.validStylePresets,
        status: 200,
        creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
    });
});

app.use((req, res, next) => {
    res.status(404).json({
        content: "Not Found!",
        status: 404,
        creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
    });
});

app.listen(PORT, () => {
    console.log(chalk.green(`App Listening On Port ${PORT}!`));
});
