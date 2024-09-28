const express = require("express");
const rateLimit = require("express-rate-limit");
const axios = require("axios");
const crypto = require("crypto");
const config = require("./config.json");
const cors = require("cors");
const logger = require("morgan");
const chalk = require("chalk");
const bodyParser = require("body-parser");
const { Prodia } = require("prodia.js");
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./swagger.json");
const { SwaggerTheme, SwaggerThemeNameEnum } = require("swagger-themes");
const theme = new SwaggerTheme();

if (!config.Setup.key) {
  console.error(
    chalk.red(
      "\n\nPlease Input Your Prodia Apikey In config.json\n\nVisit this web to get apikey: https://app.prodia.com/api\n\n",
    ),
  );
  process.exit(1);
}
const { generateImage, generateImageSDXL, wait } = Prodia(config.Setup.key);

const app = express();
const PORT = process.env.PORT || 4000;
const apiLimiter = rateLimit({
  windowMs: 5 * 1000,
  max: 50,
  message: {
    content: "Too many requests.",
    status: 429,
    creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
  },
});
app.set("json spaces", 2);
app.set("trust proxy", 1);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(swaggerUi.serve);
app.use("/api/", apiLimiter);

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
  logger((tokens, req, res) =>
    [
      req.ip,
      tokens.method(req, res),
      tokens.url(req, res),
      status(tokens.status(req, res)),
      `${tokens["response-time"](req, res)} ms`,
      formatBytes(
        isNaN(tokens.res(req, res, "content-length"))
          ? 0
          : tokens.res(req, res, "content-length"),
      ),
    ].join(" | "),
  ),
);

app.get("/", async (req, res) => {
  swaggerDocument.host = req.get("host");
  swaggerDocument.schemes = [req.protocol];
  swaggerDocument.servers = [
    {
      url: `${req.protocol}://${req.get("host")}`,
      description: "STABLE SERVER",
    },
  ];
  const customCss = `
    .swagger-ui .topbar .download-url-wrapper { display: none } 
    .swagger-ui .topbar-wrapper img[alt="Stable Diffusion API"], .topbar-wrapper span { visibility: collapse; }
    .swagger-ui .topbar-wrapper img { content: url("https://i.ibb.co.com/F6CS4fP/Tak-berjudul2-20240604073140.png"); }
    .swagger-ui .opblock-section-body .parameters-col_description { width: 50px; }
    .swagger-ui .response-col_links { display: none; }
  `;
  res.send(
    swaggerUi.generateHTML(swaggerDocument, {
      customCss:
        customCss + (await theme.getBuffer(SwaggerThemeNameEnum.DRACULA)),
      customfavIcon:
        "https://i.ib.co.com/878zHng/Tak-berjudul4-20240604073614.png",
      customSiteTitle: swaggerDocument.info.title,
      customSiteDesc: swaggerDocument.info.description,
    }),
  );
});

app.get("/swagger.json", (req, res) => {
  swaggerDocument.host = req.get("host");
  swaggerDocument.schemes = [req.protocol];
  swaggerDocument.servers = [
    {
      url: `${req.protocol}://${req.get("host")}`,
      description: "STABLE SERVER",
    },
  ];
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

  const {
    prompt,
    model,
    typeModel,
    stylePreset,
    height,
    width,
    negativePrompt,
    upscale,
    view,
  } = req.query;

  console.log(chalk.blue("Incoming parameters:"), {
    prompt,
    negativePrompt,
    model,
    typeModel,
    stylePreset,
    height,
    width,
    upscale,
    view,
  });

  const missingParams = [];
  if (!prompt) missingParams.push("prompt");
  if (!model) missingParams.push("model");
  if (!typeModel) missingParams.push("typeModel");
  if (!stylePreset) missingParams.push("stylePreset");
  if (!view) missingParams.push("view");

  if (missingParams.length > 0) {
    const message = `Missing parameters: ${missingParams.join(", ")}.`;
    console.log(chalk.yellow(message));
    return res.status(400).json({
      content: message,
      status: 400,
      creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
    });
  }

  const typeModelLowerCase = typeModel.toLowerCase();

  const validModelsKey =
    typeModelLowerCase === "sdxl" ? "validModelsSDXL" : "validModelsDefault";
  if (!config.Model[validModelsKey]?.hasOwnProperty(model.toLowerCase())) {
    const validModels = typeModelLowerCase === "sdxl" ? "SDXL" : "default";
    const message = `Invalid model for ${validModels}. Please choose a valid ${validModels} model. See list of models in '/api/v1/models'.`;
    console.log(chalk.yellow(message));
    return res.status(400).json({
      content: message,
      status: 400,
      creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
    });
  }

  let styleValue = null;
  if (stylePreset) {
    const styleToLowerCase = stylePreset.toLowerCase();
    styleValue =
      styleToLowerCase === "default"
        ? null
        : config.Model.validStylePresets[styleToLowerCase];

    if (!styleValue && styleToLowerCase !== "default") {
      const message =
        "Invalid style preset. Please choose a valid style preset.";
      console.log(chalk.yellow(message));
      return res.status(400).json({
        content: message,
        status: 400,
        creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
      });
    }
  }

  const heightValue =
    height === "default" || height === "0" ? null : parseInt(height);
  const widthValue =
    width === "default" || width === "0" ? null : parseInt(width);

  const validHeight =
    heightValue === null || (heightValue > 0 && heightValue <= 1024);
  const validWidth =
    widthValue === null || (widthValue > 0 && widthValue <= 1024);

  if (!validHeight || !validWidth) {
    const message =
      "Invalid height or width. Please provide values between 1 and 1024, or use 'default' or '0'.";
    console.log(chalk.yellow(message));
    return res.status(400).json({
      content: message,
      status: 400,
      creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
    });
  }

  if (
    upscale &&
    upscale.toLowerCase() !== "true" &&
    upscale.toLowerCase() !== "false"
  ) {
    const message = "Invalid upscale value. Please provide 'true' or 'false'.";
    console.log(chalk.yellow(message));
    return res.status(400).json({
      content: message,
      status: 400,
      creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
    });
  }

  if (view && view.toLowerCase() !== "json" && view.toLowerCase() !== "image") {
    const message = "Invalid view value. Please provide 'json' or 'image'.";
    console.log(chalk.yellow(message));
    return res.status(400).json({
      content: message,
      status: 400,
      creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
    });
  }

  try {
    const generateFunc =
      typeModelLowerCase === "sdxl" ? generateImageSDXL : generateImage;

    const generationParams = {
      prompt: prompt.trim(),
      model:
        config.Model[
          `validModels${typeModelLowerCase === "sdxl" ? "SDXL" : "Default"}`
        ][model.toLowerCase()],
      sampler: "DPM++ 2M Karras",
      seed: -1,
      cfg_scale: 7,
      steps: 20,
      upscale: upscale ? upscale.toLowerCase() === "true" : undefined,
    };

    if (validHeight && heightValue !== null) {
      generationParams.height = heightValue;
    }
    if (validWidth && widthValue !== null) {
      generationParams.width = widthValue;
    }
    if (styleValue && styleValue !== null) {
      generationParams.style_preset = styleValue;
    }
    if (negativePrompt) {
      generationParams.negative_prompt = negativePrompt.trim();
    }

    const result = await generateFunc(generationParams);

    console.log(
      chalk.blue("Parameters passed to generateFunc:"),
      generationParams,
    );

    const { status, imageUrl } = await wait(result);

    if (status === "failed") {
      const message = "Stable diffusion failed. Try again later.";
      console.log(chalk.red(message));
      return res.status(500).json({
        content: message,
        status: 500,
        creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
      });
    }

    if (view.toLowerCase() === "json") {
      console.log(chalk.green("Image URL sent successfully"));
      return res.status(200).json({
        content: imageUrl,
        status: 200,
        creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
      });
    } else if (view.toLowerCase() === "image") {
      const response = await axios.get(imageUrl, {
        responseType: "arraybuffer",
      });

      const randomFilename = crypto
        .randomBytes(5)
        .toString("hex")
        .toUpperCase();
      console.log(chalk.green("Image sent successfully"));
      res.set("Content-Type", "image/png");
      res.set(
        "Content-Disposition",
        `inline; filename="Stablediff-${randomFilename}.png"`,
      );
      return res.send(Buffer.from(response.data, "binary"));
    }
  } catch (e) {
    console.error(chalk.red("Error occurred:"), e.message);

    if (e.response && e.response.data) {
      console.error(chalk.red("Error response data:"), e.response.data);
    }

    return res.status(500).json({
      content: "Internal Server Error",
      status: 500,
      creator: `${config.Setup.apiName} - ${config.Setup.creator}`,
    });
  }
});

app.get("/api/v1/styleSheet", (req, res) => {
  res.status(200).json({
    stylePresets: Object.keys(config.Model.validStylePresets),
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
