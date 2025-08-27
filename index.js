const express = require('express')
const dotenv = require('dotenv')
dotenv.config()

const cors = require('cors')

const app = express()

app.use(express.json());


app.use(cors({
    origin:["http://localhost:3000","https://free-lexity.vercel.app/"],
    methods:"*"
}))

const router = require('./routes/index')

app.use("/api",router)

app.get("/",(req,res)=>{
    res.send("hello")
})




app.listen(8000,()=>{
    console.log("App is running")
})