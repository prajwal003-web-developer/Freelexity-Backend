const axios = require("axios");
const cheerio = require("cheerio");


const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");

// Init Gemini API
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "text-embedding-004",
  apiKey: process.env.GEMINI_API_KEY,
});

const userData = {};
const sessionStores = new Map(); // Local in-memory DB


const UserImages = {}


// ============ MAIN SEARCH ==============
const getSearch = async (req, res) => {
  try {
    const { query, searchid } = req.query;

    if (!query) throw new Error("Query Not Found");

    const url = "https://api.langsearch.com/v1/web-search";
    const payload = {
      query: query,
      freshness: "noLimit",
      summary: true,
      count: 5,
    };

    const headers = {
      Authorization: `Bearer ${process.env.SEARCH_API}`,
      "Content-Type": "application/json",
    };
    const response = await axios.post(url, payload, { headers });

    const data = response.data.data?.webPages?.value || [];

    userData[searchid] = [`question from user : ${query}`];



    // const basicData = data.map(itm => itm.snippet)

    const scrapedData = await getSummary([data[0].url, data[0].url], searchid) || data[0].summary
    
    const imagesLinks = UserImages[searchid].map((itm)=>{
      return itm.images.map(itm=>itm.src)
    }) || []

   

    let datas = [...scrapedData,...imagesLinks[0]  ]


    const chunks = await chunkText(datas)

    await saveToSession(searchid, chunks);

    const basicData = await querySession(searchid, query)

    setTimeout(async () => {
      const urls = data.map(itm => itm.url)
      const summary = await getSummary(urls, searchid)
      const chunks = await chunkText(summary);
      await saveToSession(searchid, chunks);

    }, 300)






    // Auto-clean after 25 mins
    setTimeout(() => {
      if (userData[searchid]) {
        delete userData[searchid];
        delete UserImages[searchid]
      }
    }, 25 * 60 * 1000);

    // const dataToFeed = await querySession(searchid, query);

    const result = await generateOutput(basicData, searchid, query)

    const images = UserImages[searchid]

    delete UserImages[searchid]


    return res.status(200).json({
      data: response.data,
      aiResponse: result.response.text(),
      Files:images
    });
  } catch (error) {
    console.error("Error in getSearch:", error.message);
    return res.status(500).json({
      message: error.message || "Failed in API",
    });
  }
};

// ============ QUERY AI FROM SESSION ============
const getBasicAIInfo = async (req, res) => {
  try {
    const { query, searchid } = req.query;

    if (!searchid) throw new Error("SearchId Not Found Here");

    let data = userData[searchid];


    if (!data) {
      // fallback: fetch again

      console.log("here")
      const url = "https://api.langsearch.com/v1/web-search";
      const payload = {
        query: query,
        freshness: "noLimit",
        summary: true,
        count: 6,
      };

      const headers = {
        Authorization: `Bearer ${process.env.SEARCH_API}`,
        "Content-Type": "application/json",
      };
      const response = await axios.post(url, payload, { headers });

      let data = response.data.data?.webPages?.value;

      const urls = data.map(itm => itm.url)

      let summary = await getSummary(urls, searchid)


      const chunks = await chunkText(summary);
      await saveToSession(searchid, chunks);

      setTimeout(() => {
        if (userData[searchid]) {
          delete userData[searchid];
          delete UserImages[searchid]
        }
      }, 25 * 60 * 1000);
    }

    userData[searchid] = [`question from user : ${query}`];


    const dataToFeed = await querySession(searchid, query);


    const result = await generateOutput(dataToFeed, searchid, query)

    delete UserImages[searchid]


    return res.status(200).json({
      data: result.response.text(),
    });
  } catch (error) {
    console.error("Error in getBasicAIInfo:", error.message);
    return res.status(500).json({
      message: error.message || "Failed in API",
    });
  }
};






module.exports = {
  getSearch,
  getBasicAIInfo,
};

// ============ HELPERS ============

async function chunkText(docs) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 800,
    chunkOverlap: 120,
  });

  let allChunks = [];


  for (const doc of docs) {
    const chunks = await splitter.splitText(doc);
    allChunks = allChunks.concat(chunks);
  }
  return allChunks;
}

async function saveToSession(sessionId, chunks) {
  const vectorStore = await MemoryVectorStore.fromTexts(
    chunks,
    chunks.map(() => ({ sessionId })),
    embeddings
  );

  sessionStores.set(sessionId, vectorStore);

  // Auto-delete after 20 minutes
  setTimeout(() => {
    sessionStores.delete(sessionId);
    console.log(`🗑️ Deleted session: ${sessionId} after 20 min`);
  }, 20 * 60 * 1000);
}

async function querySession(sessionId, query) {
  const vectorStore = sessionStores.get(sessionId);
  if (!vectorStore) throw new Error("❌ Session expired or not found");

  const result1 = await vectorStore.similaritySearch(query , 4);

   const result2 = await vectorStore.similaritySearch(`${query} images img // https//` , 3);

   const results = [...result1,...result2]

  return results.map((r) => r.pageContent);
}


const generateOutput = async (dataToFeed, searchid, query) => {


  const today = new Date()

  const prompt = `
You are Bot A Free tool made by me at Freelexity. 
You have some content. Answer the user's question with those given summaries.

If you know the answer from your own knowledge, 
but it should be related to the question and you must be pretty sure.But also add given by me i cant find in context type thing and request to search again
if the data is not found in context 

Try explaining in a way that user like or understand in long

question was asked on ${today}

Content:
${dataToFeed.join("\n")}

PreviousChat: ${userData[searchid]} also use this to know user query

Question: ${query} Question Ends'

At the end of your response, if you find any files with extensions .jpg, .jpeg, .png, or .webm or any  please dont send same image twice  create a JSON object containing an array of these URLs. Surround the JSON with special markers <image> at the beginning and <image> at the end. Only include valid, accessible image URLs; if there are none, skip this part entirely and act as if it doesn’t exist.

Example format:

<image>
{
  "images": [
    "https://example.com/image1.jpg",
    "https://example.com/video.webm"
  ]
}
<image>

strictly Follow these rules: You dont have to say that you are a bot and all in every ans or any where  , if somebody ask reply with i am freelexity your search engine. 
2nd rule if question is completely diffrent dont answer with your context also just make the user know that his question is completely diffrent from your search request and you cant help with it and two search again [you can modify how you tell the user about this .] 

`;


  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  userData[searchid].push('You Replied the Query')

  return result
}


const scrapedata = async (url, sid) => {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const $ = cheerio.load(data);

    // Extract all text (cleaned, no extra whitespace)
    const text = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim();

    const images = [];
    $("img").each((i, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src");
      const alt = $(el).attr("alt") || "";
      if (src && /\.(jpg|jpeg|png)$/i.test(src)) {
        images.push({ src, alt });
      }
    });

    // Extract all videos
    const videos = [];
    $("video").each((i, el) => {
      const src = $(el).attr("src");
      if (src && src.startsWith('http')) {
        videos.push({ src });
      }

      // Also check for <source> inside <video>
      $(el)
        .find("source")
        .each((j, s) => {
          const source = $(s).attr("src");
          if (source && /\.(mp4|webm|ogg)$/i.test(source)) {
            videos.push({ src: source });
          }
        });
    });

    if(UserImages[sid]){
      UserImages[sid].push({images:images , videos:videos})
    }else{
      UserImages[sid] = [{images:images , videos:videos}]
    }

    return text
  } catch (err) {

    console.error(`Failed scraping ${url}:`, err.message);
    return null
  }
};

const getSummary = async (arrayOfUrls = [], sid) => {
  const results = await Promise.all(arrayOfUrls.map((url) => scrapedata(url, sid)));
  return results.filter(Boolean); // remove null entries
};