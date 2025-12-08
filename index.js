const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@clubspherecluster.dtqqgcu.mongodb.net/?appName=ClubSphereCluster`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
    const db = client.db("club_db");
    const usersCollection = db.collection("users");
    const clubsCollection = db.collection("clubs");
    const membershipsCollection = db.collection("memberships");
    const eventsCollection = db.collection("events");
    const eventRegistrationsCollection = db.collection("event_registrations");
    const paymentsCollection = db.collection("payments");

    console.log("Database and collections initialized.");

    // --- API Routes Implementation ---

    // Root/Health Check Route
    app.get('/', (req, res) => {
      res.send('Club Management Server is Running and Connected to DB');
    });

    // --- Users Routes ---

    // POST: Create a new user (Registration)
    app.post('/users', async (req, res) => {
      try {
        const newUser = req.body;
        const result = await usersCollection.insertOne(newUser);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).send({ message: "Failed to create user." });
      }
    });

    // GET: Get all users
    app.get('/users', async (req, res) => {
      try {
        const users = await usersCollection.find({}).toArray();
        res.send(users);
      } catch (error) {
        console.error("Error getting users:", error);
        res.status(500).send({ message: "Failed to fetch users." });
      }
    });

    // --- Club Routes ---

    // POST: Create a new club
    app.post('/clubs', async (req, res) => {
      try {
        const newClub = req.body;
        const result = await clubsCollection.insertOne(newClub);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error creating club:", error);
        res.status(500).send({ message: "Failed to create club." });
      }
    });

    // GET: Get all clubs
    app.get('/clubs', async (req, res) => {
      try {
        const clubs = await clubsCollection.find({}).toArray();
        res.send(clubs);
      } catch (error) {
        console.error("Error getting clubs:", error);
        res.status(500).send({ message: "Failed to fetch clubs." });
      }
    });

    // GET: Get a single club by ID
    app.get('/clubs/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid Club ID format." });
        }
        const query = { _id: new ObjectId(id) };
        const club = await clubsCollection.findOne(query);

        if (club) {
          res.send(club);
        } else {
          res.status(404).send({ message: "Club not found." });
        }
      } catch (error) {
        console.error("Error getting club by ID:", error);
        res.status(500).send({ message: "Failed to fetch club." });
      }
    });

    // --- Events Routes ---

    // POST: Create a new event
    app.post('/events', async (req, res) => {
      try {
        const newEvent = req.body;
        const result = await eventsCollection.insertOne(newEvent);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error creating event:", error);
        res.status(500).send({ message: "Failed to create event." });
      }
    });

    // GET: Get all events
    app.get('/events', async (req, res) => {
      try {
        const events = await eventsCollection.find({}).toArray();
        res.send(events);
      } catch (error) {
        console.error("Error getting events:", error);
        res.status(500).send({ message: "Failed to fetch events." });
      }
    });

    // --- Event Registration Routes ---

    // POST: Register for an event
    app.post('/event-registrations', async (req, res) => {
      try {
        const registration = req.body;
        if (!registration.eventId || !registration.userEmail || !registration.clubId) {
          return res.status(400).send({ message: "Missing required fields." });
        }

        const result = await eventRegistrationsCollection.insertOne(registration);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error registering for event:", error);
        res.status(500).send({ message: "Failed to register for event." });
      }
    });

    // GET: Get event registrations (optionally filter by email)
    app.get('/event-registrations', async (req, res) => {
      try {
        const { email } = req.query;
        let query = {};
        if (email) {
          query = { userEmail: email };
        }
        const registrations = await eventRegistrationsCollection.find(query).toArray();
        res.send(registrations);
      } catch (error) {
        console.error("Error fetching event registrations:", error);
        res.status(500).send({ message: "Failed to fetch registrations." });
      }
    });

    // --- Membership Routes ---

    // POST: Create a new membership
    app.post('/memberships', async (req, res) => {
      try {
        const membership = req.body;
        if (!membership.userEmail || !membership.clubId) {
          return res.status(400).send({ message: "Missing required fields." });
        }

        if (!membership.status) {
          membership.status = 'active';
        }

        membership.joinedAt = new Date();

        const result = await membershipsCollection.insertOne(membership);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error creating membership:", error);
        res.status(500).send({ message: "Failed to create membership." });
      }
    });

    // GET: Get memberships (optionally filter by email)
    app.get('/memberships', async (req, res) => {
      try {
        const { email } = req.query;
        let query = {};
        if (email) {
          query = { userEmail: email };
        }
        const memberships = await membershipsCollection.find(query).toArray();
        res.send(memberships);
      } catch (error) {
        console.error("Error fetching memberships:", error);
        res.status(500).send({ message: "Failed to fetch memberships." });
      }
    });

    // --- Payment Routes ---

    // POST: Record a payment
    app.post('/payments', async (req, res) => {
      try {
        const payment = req.body;
        if (!payment.userEmail || !payment.amount || !payment.type) {
          return res.status(400).send({ message: "Missing required payment fields." });
        }

        payment.createdAt = new Date();
        payment.status = 'completed';

        const result = await paymentsCollection.insertOne(payment);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error recording payment:", error);
        res.status(500).send({ message: "Failed to record payment." });
      }
    });

    // GET: Get payments (optionally filter by email)
    app.get('/payments', async (req, res) => {
      try {
        const { email } = req.query;
        let query = {};
        if (email) {
          query = { userEmail: email };
        }
        const payments = await paymentsCollection.find(query).toArray();
        res.send(payments);
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).send({ message: "Failed to fetch payments." });
      }
    });

    // --- Error Handling Middleware ---
    app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).send('Something broke!');
    });

    // --- Start the Express Server ---
    app.listen(port, () => {
      console.log(`Server is listening on port ${port}`);
    });

  } finally {
    // await client.close(); 
  }
}

run().catch(console.dir);
