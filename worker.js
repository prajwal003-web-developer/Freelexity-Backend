const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");

// Create a Redis connection
const connection = new IORedis({
  host: "127.0.0.1",
  port: 6379,
});

// Create the queue
const scrapeQueue = new Queue("scrapeQueue", { connection });

// Create a worker in the same file (optional)
const worker = new Worker(
  "scrapeQueue",
  async (job) => {
    console.log("Running job:", job.id, job.data);
    // Do your background processing here
  },
  { connection }
);

// Add a job
scrapeQueue.add("scrape-task", { url: "https://example.com" });

console.log("Queue and worker initialized!");
