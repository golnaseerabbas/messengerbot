import { createRequire } from "module";
import { setgroups } from "process";
const express = require("express");
const puppeteer = require("puppeteer");

const cors = require("cors");
const app = express();
const { Configuration, OpenAIApi } = require("openai");
const fs = require('fs');
const apikey = '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';

const PORT = 4000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

let openai: any;
setupApi();

app.get("/api/models", async (req: any, res: any) => {

  const modelList = await getModelList();

  if (modelList.error) {
    res.json({
      code: 400,
      data: null,
      error: modelList.error
    });
  }

  res.json({
    code: 200,
    data: modelList.data,
    error: null
  });
});

app.get("/api/status", async (req: any, res: any) => {

  if(!req.query?.id){
    return res.json({
      code: 400,
      data: null,
      error: 'id is missing'
    });
  }

  const modelList = await modelStatus(req.query.id);

  if (modelList.error) {
    return res.json({
      code: 400,
      data: null,
      error: modelList.error
    });
  }

  return res.json({
    code: 200,
    data: modelList,
    error: null
  });
});



app.post("/api/model/create", async (req: any, res: any) => {

//   let qaData = await createQuestions('hello how are you');
// return qaData;
  try {
    const payload = req.body;


    if (!payload.model_name) {
      payload.model_name = 'alive5-qa';
      // throw 'model name is missing';
    }


    let websiteContent = await extractWebpageContent(payload);
    if (!websiteContent) {
      throw 'no content is found';
    }

    await setupApi();

    let qaData = await createQuestions(websiteContent);

    if (qaData.error) {
      throw qaData.error;
    }

    const fileRes = await createfile(qaData);

    if (fileRes.error) {
      throw fileRes.error;
    }


    let modelData = await fineTuneModel(fileRes.id, payload.model_name);

    if (modelData.error) {
      throw modelData.error;
    }

    let resObj = {
      ...modelData.data,
      file_id: fileRes.id
    };

    console.log('successfully created', modelData);

    return res.json({
      code: 200,
      data: resObj,
      error: null
    });

  }
  catch (error: any) {
    console.log('Error: ', error);
    return res.json({
      code: 400,
      data: null,
      error: error
    });
  }


});

async function setupApi() {
  console.log('2. setup');
  const configuration = new Configuration({
    apiKey: apikey,
  });
  openai = new OpenAIApi(configuration);
}

async function extractWebpageContent(payload: any) {
  console.log('1. extractWebpageContent', payload);
  let websiteContent;

  if (payload.url) {
    const url = payload.url;
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url);

    websiteContent = await page.evaluate(() => {
      return document.documentElement.innerText.trim();
    });
  } else if (payload.text) {
    websiteContent = payload.text;
  } else {
    return;
  }
  return websiteContent;
}

async function createQuestions(content: any) {
  console.log('3. createQuestions', content);

  try {
    const completion = await openai.createCompletion(
      {
        model: "text-davinci-003",
        prompt: `please generate 10 possible question answer from this text into json format: ${content}`,
        temperature: 0,
        max_tokens: 2000
      });
    if (!completion?.data?.choices?.[0]?.text) {
      return { error: 'data not found' };
    }
    let responseObj = completion.data.choices[0].text.replace(/\.\n|\n/g, '');

    try {
      responseObj = JSON.parse(responseObj);
    } catch (error: any) {
      console.log('error in parse results');
    }
    console.log('completion.data.choices[0].text;', responseObj);
    return responseObj;
  } catch (error: any) {
    let errorStr = '';
    if (error.response) {
      console.log(error.response.status);
      console.log(error.response.data);
      errorStr = error.response.data;
    } else {
      errorStr = error.message;
      console.log(error.message);
    }
    return { error: errorStr };
  }
}

async function createfile(content: any) {
  console.log('4. createfile');
  const filePath = './output.jsonl';

  if (fs.existsSync(filePath)) {
    console.log('------ file already exist  -------');
    await fs.unlink(filePath, (err: any) => {
      if (err) {
        console.log(`unlink file error ${err}`);
      }
      console.log('file deleted');
    });
  }

  await Promise.all(content.map(async (item: any) => {
    const modeldata = { prompt: item.question, completion: item.answer };
    let jsonContent = JSON.stringify(modeldata);

    await fs.appendFile("output.jsonl", jsonContent + "\n", (err: any) => {
      if (err) {
        console.log("An error occured while writing JSON Object to File.");
        return console.log(err);
      }
      console.log(`${jsonContent} Added`);
    });
    return;
  }));

  try {
    const upFileResponse = await openai.createFile(fs.createReadStream("output.jsonl"), "fine-tune");
    if (!upFileResponse?.data?.id) {
      return { error: 'file id is missing' };
    }
    return upFileResponse.data;
  } catch (error: any) {
    let errorStr = '';
    if (error.response) {
      console.log(error.response.status);
      console.log(error.response.data);
      errorStr = error.response.data;
    } else {
      errorStr = error.message;
      console.log(error.message);
    }
    return { error: errorStr };
  }

}

async function fineTuneModel(fileId: any, model_name: any) {
  console.log('5. fineTuneModel');
  try {
    const upFileResponse = await openai.createFineTune({
      training_file: fileId,
      suffix: model_name
    });


    console.log('upfileres', upFileResponse);
    return upFileResponse;
  } catch (error: any) {
    let errorStr = '';
    if (error.response) {
      console.log(error.response.status);
      console.log(error.response.data);
      errorStr = error.response.data;
    } else {
      errorStr = error.message;
      console.log(error.message);
    }
    return { error: errorStr };
  }

}

async function getModelList() {
  try {
    const models = await openai.listFineTunes();
    if (!models.data) {
      return 'no data found'
    }
    return models.data;
  } catch (error: any) {
    let errorStr = '';
    if (error.response) {
      console.log(error.response.status);
      console.log(error.response.data);
      errorStr = error.response.data;
    } else {
      errorStr = error.message;
      console.log(error.message);
    }
    return { error: errorStr };
  }
}

async function modelStatus(id: any) {
  try {
    const modelStatus = await openai.listFineTuneEvents(id);
    console.log('modelStatus', modelStatus);
    if (!modelStatus.data) {
      return 'no data found'
    }
    return modelStatus.data;
  } catch (error: any) {
    let errorStr = '';
    if (error.response) {
      console.log(error.response.status);
      console.log(error.response.data);
      errorStr = error.response.data;
    } else {
      errorStr = error.message;
      console.log(error.message);
    }
    return { error: errorStr };
  }
}




app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});