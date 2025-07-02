// imports /////////////////////////////////////////////////////////////////////

import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config({ path: "./config.env" });
import pg from "pg";
import bcrypt from "bcrypt";

// constants ///////////////////////////////////////////////////////////////////

const app = express();
const port = 3000;
const openWeatherKey = process.env.OPEN_WEATHER_KEY;
const saltRounds = 10;

const db = new pg.Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});


// structures //////////////////////////////////////////////////////////////////

let categoryFilter = "None";
let userId = null;
let displayName = null;
// WARNING: there can only be one user per session

// middleware //////////////////////////////////////////////////////////////////

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
db.connect();

// page requests ///////////////////////////////////////////////////////////////

// render the home page (blog)
app.get("/", async (req, res) => {

    try {

        // get all blogs from database
        const blogPostsResponse = await db.query("SELECT * FROM blogs");
        res.render("index.ejs", {blogPosts : blogPostsResponse.rows, categoryFilter, userId});
    
    // display any errors
    } catch (err) {
        console.error("error executing query", err);
    }

});

// render the home page by link
app.post("/", (req, res) => {

    res.redirect("/");

});

// render sign in page
app.get("/signin", (req, res) => {

    res.render("signin.ejs", {userId});

});

// render sign up page
app.get("/signup", (req, res) => {

    res.render("signup.ejs", {userId});

});

// render account page
app.get("/manage-account", (req, res) => {

    res.render("account.ejs", {userId});

});

// account functions ///////////////////////////////////////////////////////////

// creates an new account and checks for duplicate usernames
app.post("/create-account", async (req, res) => {

    // get variables from ejs file
    const newUsername = req.body["username"];
    const newPassword = req.body["password"];
    const newDisplayName = req.body["disp-name"];

    try {

        // check if username already taken
        const existingUsers = await db.query("SELECT user_id FROM users WHERE user_id = $1", [newUsername]);

        if (existingUsers.rows.length > 0) {
            return res.render("signup.ejs", { error: "Username already taken", userId });
        }

        // encrypt the password
        bcrypt.hash(newPassword, saltRounds, async (err, newHash) => {

            // add user data to db
            await db.query("INSERT INTO users (user_id, password, name) VALUES ($1, $2, $3)", [newUsername, newHash, newDisplayName]);

            // go to sign-in page
            res.render("signin.ejs", {userId}); 
        })

    // catch any errors
    } catch (err) {

        console.error("error executing query", err);
        res.render("signup.ejs", {userId});
    }

});

// logs the user in when entering correct username and password
app.post("/access-account", async (req, res) => {

    // get variables from ejs file
    const userIdAttempt = req.body["username"];
    const passwordAttempt = req.body["password"];

    // get user information from username
    const result = await db.query("SELECT * FROM users WHERE user_id = $1", [userIdAttempt]);

    // check if user exists
    if(result.rows.length > 0) {

        // unencrypt password
        const hashedPassword = result.rows[0].password;
        bcrypt.compare(passwordAttempt, hashedPassword, async (err, success) => {

            // check if correct password
            if(success) {

                // set user account and render blog page
                userId = userIdAttempt;

                // get display name associated with the user id
                try {
                    const userResult = await db.query("SELECT name FROM users WHERE user_id = $1", [userId]);
                    displayName = userResult.rows[0].name;

                } catch (err) {
                    console.error("error executing query", err);
                }

                res.redirect("/");
            }

            else {
                res.render("signin.ejs", { error: "Incorrect username or password", userId });
            }
        });
    } else {
        res.render("signin.ejs", { error: "Incorrect username or password", userId });
    }
});

// sign the user out of the account
app.post("/signout", (req, res) => {

    userId = null;
    displayName = null;
    res.redirect("/");

});

// blog functions //////////////////////////////////////////////////////////////

// make a new blog post
app.post("/new", async (req, res) => {
    
    // insert new blog post into the database
    try {
        await db.query("INSERT INTO blogs (blog_id, creator_name, creator_user_id, title, body, date_created, category) VALUES (DEFAULT, $1, $2, $3, $4, $5, $6)",
        [displayName, userId, req.body["title"], req.body["content"], new Date().toLocaleString("en-US"), req.body["category"]]);

    } catch (err) {
        console.log(err);
    }

    // refresh the blog page
    res.redirect("/");

});

// delete a blog post
app.post("/delete", async (req, res) => {


    // delete item in database
    try {
        await db.query("DELETE FROM blogs WHERE blog_id = $1", [req.body["blogId"]]);

    } catch(err) {
        console.error(err);
    }

    // refresh the home page
    res.redirect("/");

});

// edit a blog post
app.post("/edit", async (req, res) => {

    // get the default values of the blog being edited
    try {

        const editResponse = await db.query("SELECT * FROM blogs WHERE blog_id = $1", [req.body["blogId"]]);
        const blogPost = editResponse.rows[0];

        res.render("edit.ejs", {blogPost, userId});

    } catch(err) {
        console.error(err);
    }

});

// update the blog post from edit
app.post("/update", async (req, res) => {

    // update the database with the new values
    try {

        await db.query("UPDATE blogs SET title = $1, category = $2, body = $3, date_created = $4 WHERE blog_id = $5",
        [req.body["title"], req.body["category"], 
        req.body["content"], new Date().toLocaleString("en-US"),  
        req.body["blogId"]]);

        res.redirect("/");
        
    } catch(err) {
        console.error(err);
    }

});

// filter blog based on sections
app.post("/filter", (req, res) => {

    categoryFilter = req.body["category"];
    res.redirect("/");

});

// API requests ////////////////////////////////////////////////////////////////

// request current weather via openweathermap
app.post("/weather", async (req, res) => {

    try {
        const lat = req.body.lat;
        const lon = req.body.lon;
        
        if(lat == null) {
            throw new Error("Missing lat or lon");
        }

        const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${openWeatherKey}`);
        const result = response.data;
        const temp = result.main.temp;
        const tempMin = result.main.temp_min;
        const tempMax = result.main.temp_max;
        const humidity = result.main.humidity;
        const weatherMain = result.weather[0].main;
        const weatherDescription = result.weather[0].description;
        const weatherIcon = result.weather[0].icon;

        res.render("weather.ejs", {temp, tempMin, tempMax, humidity, weatherMain, weatherDescription, weatherIcon, userId});
        
    } catch (error) {
        res.render("weather.ejs", {error, userId});
    }

});

// listening log ///////////////////////////////////////////////////////////////

app.listen(port, () => {

    console.log(`Listening on http://localhost:${port}`);

});

////////////////////////////////////////////////////////////////////////////////