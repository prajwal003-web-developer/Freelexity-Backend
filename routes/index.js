const express = require('express');
const { getSearch, getBasicAIInfo } = require('../controller');
const router = express.Router();

// GET /api/search?query=someText
router.get('/search',getSearch );
router.get('/summarize-ai',getBasicAIInfo)

module.exports = router;
