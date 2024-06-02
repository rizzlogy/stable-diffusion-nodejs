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
  var d = Math.floor(seconds / (3600 * 24));
  var h = Math.floor((seconds % (3600 * 24)) / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.floor(seconds % 60);
  var dDisplay = d > 0 ? d + (d == 1 ? " day, " : " days, ") : "";
  var hDisplay = h > 0 ? h + (h == 1 ? " hour, " : " hours, ") : "";
  var mDisplay = m > 0 ? m + (m == 1 ? " minute, " : " minutes, ") : "";
  var sDisplay = s > 0 ? s + (s == 1 ? " second" : " seconds") : "";
  return dDisplay + hDisplay + mDisplay + sDisplay;
}

function status(code) {
  if (code > 400 && code < 499) return chalk.yellow(code);
  if (code > 500 && code < 599) return chalk.red(code);
  if (code > 299 && code < 399) return chalk.cyan(code);
  if (code > 199) return chalk.green(code);
  return chalk.yellow(code);
}

app.use(
  logger(function (tokens, req, res) {
    return [
      req.ip,
      tokens.method(req, res),
      tokens.url(req, res),
      status(tokens.status(req, res)),
      tokens["response-time"](req, res) + " ms",
      formatBytes(
        isNaN(tokens.res(req, res, "content-length"))
          ? 0
          : tokens.res(req, res, "content-length")
      ),
    ].join(" | ");
  })
);

app.get("/", (req, res) => {
  swaggerDocument.host = req.get("host");
  swaggerDocument.schemes = ["https"];
  res.send(
    swaggerUi.generateHTML(swaggerDocument, {
      customCss: `.swagger-ui .topbar .download-url-wrapper { display: none } 
    .swagger-ui .topbar-wrapper img[alt="Stable Diffusion API"], .topbar-wrapper span {
      visibility: colapse;
    }
    .swagger-ui .topbar-wrapper img {
      content: url("https://fasturl.cloud/content/FastURL_SlimLogoSC.png");
    }
    .swagger-ui .opblock-section-body .parameters-col_description {
     width: 50px;
    }
    .swagger-ui .response-col_links {
     display: none;
    `,
      customfavIcon: "https://fasturl.cloud/content/FastURL_SlimLogoSC.png",
      customSiteTitle: swaggerDocument.info.title,
      customSiteDesc: swaggerDocument.info.description,
    }),
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
      default: config.Model.validModelsDefault,
      sdxl: config.Model.validModelsSDXL,
    },
    status: 200,
    creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
  });
});

app.get("/api/v1/generateImage", async (req, res) => {
  console.log("Received request for /api/v1/generateImage");

  const { prompt, model, typeModel, stylePreset } = req.query;

  if (!prompt || !model || !typeModel) {
    return res.status(400).json({
      content: "Missing parameters. Please provide prompt, model, and typeModel.",
      status: 400,
      creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
    });
  }

  const typeModelLowerCase = typeModel.toLowerCase();

  if (typeModelLowerCase === "sdxl" && !config.Model.validModelsSDXL.includes(model)) {
    console.log("Invalid model for SDXL. Please choose a valid SDXL model. See list model in '/api/v1/models'.");
    return res.status(400).json({
      content: "Invalid model for SDXL. Please choose a valid SDXL model. See list model in '/api/v1/models'.",
      status: 400,
      creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
    });
  }

  if (typeModelLowerCase === "default" && !config.Model.validModelsDefault.includes(model)) {
    console.log("Invalid model for default. Please choose a valid default model. See list model in '/api/v1/models'.");
    return res.status(400).json({
      content: "Invalid model for default. Please choose a valid default model. See list model in '/api/v1/models'.",
      status: 400,
      creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
    });
  }

  if (stylePreset && !config.Model.validStylePresets.includes(stylePreset)) {
    console.log("Invalid style preset. Please choose a valid style preset.");
    return res.status(400).json({
      content: "Invalid style preset. Please choose a valid style preset.",
      status: 400,
      creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
    });
  }

  try {
    const result = typeModelLowerCase === "sdxl" ? await generateImageSDXL({ prompt, model, style_preset: stylePreset || null }) : await generateImage({ prompt, model, style_preset: stylePreset || null, "height": 1024, "width": 1024, "sampler": "DPM++ 2M Karras", });
    const { status, imageUrl } = await wait(result);

    if (status === "failed") {
      console.log("Stable diffusion failed. Try again later.");
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
    console.log("Image sent successfully");
  } catch (e) {
    console.error("Error occurred:", e.message);
    return res.status(500).json({
      content: "Internal Server Error",
      status: 500,
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
  console.log(`App Listening On Port ${PORT}!`);
});
