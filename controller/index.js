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

const userImages = {}



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

    const urls = data.map(itm => {
      return itm.url
    })

    const ineed = await getSummary(urls, searchid)

    let summary = ineed.map(itm => {
      return itm.text
    }) 

     if(summary.length==0){
        summary = data.map(itm=>itm.summary)
      }

    const chunks = await chunkText(summary);



    //console.log(urls)



    await saveToSession(searchid, chunks);

    // Auto-clean after 25 mins
    setTimeout(() => {
      if (userData[searchid]) {
        delete userData[searchid];
        delete userImages[searchid]
      }
    }, 25 * 60 * 1000);

    const result = await generateOutput(searchid, query)

    return res.status(200).json({
      data: response.data,
      aiResponse: result.response.text(),
      images: userImages[searchid]
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
        count: 5,
      };

      const headers = {
        Authorization: `Bearer ${process.env.SEARCH_API}`,
        "Content-Type": "application/json",
      };
      const response = await axios.post(url, payload, { headers });

      let data = response.data.data?.webPages?.value;

      const urls = data.map(itm => {
        return itm.url
      })

      const ineed = await getSummary(urls, searchid)

      let summary = ineed.map(itm => {
        return itm.text
      })

      if(summary.length==0){
        summary = data.map(itm=>itm.summary)
      }

      const chunks = await chunkText( summary);
      await saveToSession(searchid, chunks);

      setTimeout(() => {
        if (userData[searchid]) {
          delete userData[searchid];
          delete userImages[searchid]
        }
      }, 25 * 60 * 1000);
    }

    userData[searchid].push(`Question from user ${query}`)





    // Query the vector store


    const result = await generateOutput(searchid, query)


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
    chunkSize: 500,
    chunkOverlap: 50,
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

  const results = await vectorStore.similaritySearch(query, 5);
  return results.map((r) => r.pageContent);
}


const generateOutput = async (searchid, query) => {
  const dataToFeed = await querySession(searchid, query);

  const today = new Date()

  const prompt = `
You are Bot A Free tool made by me at Freelexity. 
You have some content. Answer the user's question with those given summaries.

If you know the answer from your own knowledge, 
but it should be related to the question and you must be pretty sure.But also add given by me i cant find in context type thing and request to search again
if the data is not found in context 

Try explaining in a way that user like or understand

Content:
${dataToFeed.join("\n")}

PreviousChat: ${userData[searchid]}

Question: ${query}

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
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // Extract all text (cleaned, no extra whitespace)
    const text = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim();

    // Extract all images (with alt + src)

    $("img").each((i, el) => {
      const src = $(el).attr("src");
      const alt = $(el).attr("alt") || "";
      const data = { src, alt, imageFrom: url }
      if (src && (src.startsWith("//") || src.startsWith("https"))) {
        if (userImages[sid]) {
          userImages[sid].push(data)
        } else {
          userImages[sid] = [{ data }]
        }
      }
    });

    return { url, text };
  } catch (err) {

    return null
  }
};

const getSummary = async (arrayOfUrls = [], sid) => {
  const results = await Promise.all(arrayOfUrls.map((url) => scrapedata(url, sid)));
  return results.filter(Boolean); // remove null entries
};