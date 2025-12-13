const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@clubspherecluster.dtqqgcu.mongodb.net/?appName=ClubSphereCluster`;
const targetEmail = "tom@tom.com";

async function makeAdmin() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db("club_db");

        const result = await db.collection("users").updateOne(
            { email: targetEmail },
            { $set: { role: 'super_admin' } }
        );

        if (result.modifiedCount > 0) {
            console.log(`SUCCESS: ${targetEmail} is now a SUPER ADMIN.`);
        } else {
            console.log(`NO CHANGE: ${targetEmail} was not updated (maybe already admin or not found).`);
            const user = await db.collection("users").findOne({ email: targetEmail });
            console.log("Current State:", user);
        }

    } catch (error) {
        console.error("Error:", error.message);
    } finally {
        await client.close();
    }
}

makeAdmin();
