const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Middleware
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  //console.log('All Headers received:', req.headers); // Debugging: See all headers
  //console.log('Auth Header extraction: index line 25', authHeader);
  if (!authHeader) {
    //console.log('header in the index.js line 26', authHeader);
    return res.status(401).send({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  //console.log('header in the index.js line 30', token);

  if (!token) {
    return res.status(401).send({ message: "Unauthorized: Invalid token format" });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    //console.error("Token verification failed in index.js line 38:", error);
    return res.status(403).send({ message: "Forbidden" });
  }
}

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
    const clubManagersCollection = db.collection("club_managers");

    console.log("Database and collections initialized.");

    // --- Middlewares ---
    const verifySuperAdmin = async (req, res, next) => {
      const email = req.user.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user?.role === 'super_admin') {
        next();
      } else {
        return res.status(403).send({ message: 'forbidden access' });
      }
    };

    const verifyClubPermission = async (req, res, next) => {
      const email = req.user.email;
      const clubId = req.params.id;
      if (!clubId) {
        return res.status(400).send({ message: "Club ID is required." });
      }
      try {
        const query = { _id: new ObjectId(clubId) };
        const club = await clubsCollection.findOne(query);
        if (!club) {
          return res.status(404).send({ message: "Club not found." });
        }
        if (club.userEmail === email) {
          next();
        } else {
          return res.status(403).send({ message: "Forbidden: You are not the manager of this club." });
        }
      } catch (error) {
        return res.status(500).send({ message: "Internal Server Error during permission check." });
      }
    };

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
        newUser.role = 'member';
        const alreadyexists = await usersCollection.findOne({ email: newUser.email });
        if (alreadyexists) {
          return res.status(400).send({ message: "User already exists." });
        }
        const result = await usersCollection.insertOne(newUser);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).send({ message: "Failed to create user." });
      }
    });

    // --- Admin Routes for Stats and Payments ---

    // GET: Admin Stats (Revenue, Users, Clubs)
    app.get('/admin/stats', verifyFBToken, verifySuperAdmin, async (req, res) => {
      try {
        const totalUsers = await usersCollection.estimatedDocumentCount();
        const totalClubs = await clubsCollection.estimatedDocumentCount();
        const totalEvents = await eventsCollection.estimatedDocumentCount();

        // Calculate total revenue
        const payments = await paymentsCollection.find({}).toArray();
        const totalRevenue = payments.reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);

        res.send({
          totalUsers,
          totalClubs,
          totalEvents,
          totalRevenue
        });
      } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).send({ message: "Failed to fetch admin statistics" });
      }
    });

    // GET: All Payments (Admin Monitor)
    app.get('/admin/payments', verifyFBToken, verifySuperAdmin, async (req, res) => {
      try {
        const payments = await paymentsCollection.find({}).sort({ createdAt: -1 }).toArray();
        res.send(payments);
      } catch (error) {
        console.error("Error fetching all payments:", error);
        res.status(500).send({ message: "Failed to fetch payments" });
      }
    });

    // --- Users Routes ---

    // GET: Get all users (Protected: Super Admin only)
    // GET: Get all users (with optional search)
    app.get('/users', verifyFBToken, verifySuperAdmin, async (req, res) => {
      try {
        const { search } = req.query;
        let query = {};
        if (search) {
          query = {
            $or: [
              { name: { $regex: search, $options: 'i' } },
              { email: { $regex: search, $options: 'i' } }
            ]
          };
        }
        const users = await usersCollection.find(query).toArray();
        res.send(users);
      } catch (error) {
        console.error("Error getting users:", error);
        res.status(500).send({ message: "Failed to fetch users." });
      }
    });

    // PATCH: Admin updates user role/status (Promote/Ban)
    app.patch('/users/admin/:id', verifyFBToken, verifySuperAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const { role, status } = req.body;
        const filter = { _id: new ObjectId(id) };

        let updateDoc = { $set: {} };
        if (role) updateDoc.$set.role = role;
        if (status) updateDoc.$set.status = status;

        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error updating user (admin):", error);
        res.status(500).send({ message: "Failed to update user." });
      }
    });

    // GET: Get user role by email
    app.get('/users/role/:email', async (req, res) => {
      try {
        const email = req.params.email;
        const query = { email: email };
        const user = await usersCollection.findOne(query);
        if (user) {
          res.send({ role: user.role });
        } else {
          res.status(404).send({ message: "User not found" });
        }
      } catch (error) {
        console.error("Error fetching user role:", error);
        res.status(500).send({ message: "Failed to fetch user role" });
      }
    });

    // PATCH: Update user profile
    app.patch('/users/:email', verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        const updatedUser = req.body;
        const filter = { email: email };
        const updateDoc = {
          $set: {
            name: updatedUser.name,
            photoURL: updatedUser.photoURL
          }
        };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).send({ message: "Failed to update user profile." });
      }
    });

    // --- Club Routes ---

    // POST: Create a new club
    app.post('/clubs', async (req, res) => {
      try {
        const newClub = req.body;
        newClub.status = 'pending'; // Set default status for new clubs
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
        const { status, email, search, category, sort } = req.query;
        let query = {};

        // Filter by Status
        if (status) {
          query.status = status;
        }

        // Filter by Manager Email
        if (email) {
          query.userEmail = email;
        }

        // Search by Club Name
        if (search) {
          query.clubName = { $regex: search, $options: 'i' };
        }

        // Filter by Category
        if (category) {
          query.category = category;
        }

        // Sorting
        let sortOptions = {};
        if (sort) {
          const [field, order] = sort.split(':'); // e.g., "createdAt:desc" or "membershipFee:asc"
          if (field && order) {
             sortOptions[field] = order === 'desc' ? -1 : 1;
          }
        } else {
             sortOptions = { createdAt: -1 }; // Default sort
        }

        const clubs = await clubsCollection.find(query).sort(sortOptions).toArray();
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

    // PATCH: Update club details (Status or General Info)
    app.patch('/clubs/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedClub = req.body;
        const filter = { _id: new ObjectId(id) };
        
        // Construct update document dynamically
        const updateDoc = { $set: {} };

        // Admin-only field (ideally check role, but keeping simple for now or mixed usage)
        if (updatedClub.status) updateDoc.$set.status = updatedClub.status;

        // Manager allowable fields
        if (updatedClub.clubName) updateDoc.$set.clubName = updatedClub.clubName;
        if (updatedClub.description) updateDoc.$set.description = updatedClub.description;
        if (updatedClub.location) updateDoc.$set.location = updatedClub.location;
        if (updatedClub.category) updateDoc.$set.category = updatedClub.category;
        if (updatedClub.bannerImage) updateDoc.$set.bannerImage = updatedClub.bannerImage;
        // Handle membershipFee - check if it's defined (can be 0)
        if (updatedClub.membershipFee !== undefined) updateDoc.$set.membershipFee = updatedClub.membershipFee;


        const result = await clubsCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error updating club:", error);
        res.status(500).send({ message: "Failed to update club." });
      }
    });



    // --- Club Manager Dashboard Routes ---

    // GET: Club Manager Stats
    app.get('/clubs/:id/manager-stats', async (req, res) => {
      try {
        const clubId = req.params.id;

        // Member Counts
        const totalMembers = await membershipsCollection.countDocuments({ clubId: clubId, status: 'active' });
        const pendingMembers = await membershipsCollection.countDocuments({ clubId: clubId, status: 'pending' });

        // Event Counts
        const totalEvents = await eventsCollection.countDocuments({ clubId: clubId });
        // Using logic on date for upcoming events, or simpler just count for now
        const upcomingEvents = await eventsCollection.countDocuments({
          clubId: clubId,
          date: { $gte: new Date().toISOString() } // Assuming ISO string storage, verify date format if needed
        });

        // Revenue calculation
        const payments = await paymentsCollection.find({ clubId: clubId }).toArray();
        const totalRevenue = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

        res.send({
          members: { total: totalMembers, pending: pendingMembers },
          events: { total: totalEvents, upcoming: upcomingEvents },
          revenue: totalRevenue
        });

      } catch (error) {
        console.error("Error fetching manager stats:", error);
        res.status(500).send({ message: "Failed to fetch manager stats" });
      }
    });

    // GET: Club Finance (Transactions)
    app.get('/clubs/:id/finance', verifyFBToken, async (req, res) => {
      try {
        const clubId = req.params.id;
        const payments = await paymentsCollection.find({ clubId: clubId }).sort({ createdAt: -1 }).toArray();
        res.send(payments);
      } catch (error) {
        console.error("Error fetching club finance:", error);
        res.status(500).send({ message: "Failed to fetch club finance" });
      }
    });

    // GET: Club Members List
    app.get('/clubs/:id/members', verifyFBToken, async (req, res) => {
      try {
        const clubId = req.params.id;
        const memberships = await membershipsCollection.find({ clubId: clubId }).toArray();
        res.send(memberships);
      } catch (error) {
        console.error("Error fetching club members:", error);
        res.status(500).send({ message: "Failed to fetch club members" });
      }
    });

    // PATCH: Approve/Reject Member
    app.patch('/clubs/:id/members/:email/status', verifyFBToken, async (req, res) => {
      try {
        const clubId = req.params.id;
        const userEmail = req.params.email;
        const { status } = req.body; // 'active' or 'rejected'

        if (!['active', 'rejected'].includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const updateResult = await membershipsCollection.updateOne(
          { clubId: clubId, userEmail: userEmail },
          { $set: { status: status } }
        );

        if (updateResult.modifiedCount > 0 && status === 'active') {
          // Ensure they have 'member' role in club_roles (consistency check)
          await db.collection("club_roles").updateOne(
            { clubId: clubId, userEmail: userEmail },
            {
              $set: {
                role: 'member',
                permissions: MEMBER_PERMISSIONS
              },
              $setOnInsert: { assignedAt: new Date() }
            },
            { upsert: true }
          );
        }

        res.send(updateResult);
      } catch (error) {
        console.error("Error updating member status:", error);
        res.status(500).send({ message: "Failed to update member status" });
      }
    });

    // --- Events Routes ---

    // POST: Create a new event
    app.post('/events', verifyFBToken, async (req, res) => {
      try {
        const newEvent = req.body;
        newEvent.status = 'pending';
        newEvent.createdAt = new Date();
        const result = await eventsCollection.insertOne(newEvent);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error creating event:", error);
        res.status(500).send({ message: "Failed to create event." });
      }
    });

    // GET: Get all events (with optional status filtering and clubId filtering)
    app.get('/events', async (req, res) => {
      try {
        const { status, clubId, search, sort } = req.query;
        let query = {};
        
        if (status) query.status = status;
        if (clubId) query.clubId = clubId;

        // Search
        if (search) {
          query.$or = [
            { eventTitle: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
          ];
        }

        // Sorting
        let sortOptions = { date: 1 };
        if (sort) {
           const [field, order] = sort.split(':');
           if (field && order) {
             sortOptions[field] = order === 'desc' ? -1 : 1;
           }
        }

        const events = await eventsCollection.find(query).sort(sortOptions).toArray();
        res.send(events);
      } catch (error) {
        console.error("Error getting events:", error);
        res.status(500).send({ message: "Failed to fetch events." });
      }
    });

    // GET: Get single event by ID
    app.get('/events/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid Event ID" });
        }
        const query = { _id: new ObjectId(id) };
        const event = await eventsCollection.findOne(query);
        if (event) {
          res.send(event);
        } else {
          res.status(404).send({ message: "Event not found" });
        }
      } catch (error) {
        console.error("Error fetching event:", error);
        res.status(500).send({ message: "Failed to fetch event" });
      }
    }); 

    // PUT: Update event details
    app.put('/events/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedEvent = req.body;
        const clubId = updatedEvent.clubId; 
        delete updatedEvent._id; 
        delete updatedEvent.clubId; 
        
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: updatedEvent
        };
        const result = await eventsCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error updating event:", error);
        res.status(500).send({ message: "Failed to update event." });
      }
    });

    // DELETE: Delete an event
    app.delete('/events/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await eventsCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        console.error("Error deleting event:", error);
        res.status(500).send({ message: "Failed to delete event." });
      }
    }); 

    // GET: Get registrations for a specific event
    app.get('/events/:id/registrations', verifyFBToken, async (req, res) => {
      try {
        const eventId = req.params.id;
        const registrations = await eventRegistrationsCollection.find({ eventId: eventId }).toArray();
        res.send(registrations);
      } catch (error) {
        console.error("Error fetching registrations:", error);
        res.status(500).send({ message: "Failed to fetch registrations" });
      }
    });

    // --- Event Registration Routes ---

    // POST: Register for an event
    app.post('/event-registrations', verifyFBToken, async (req, res) => {
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

    // GET: Get event registrations 
    app.get('/event-registrations', verifyFBToken, async (req, res) => {
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

    // PATCH: Update event status
    app.patch('/events/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedEvent = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: updatedEvent.status
          }
        };
        const result = await eventsCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error updating event:", error);
        res.status(500).send({ message: "Failed to update event." });
      }
    });

    // --- Membership Routes ---

    // POST: Create a new membership
    app.post('/memberships', verifyFBToken, async (req, res) => {
      try {
        const membership = req.body;
        if (!membership.userEmail || !membership.clubId) {
          return res.status(400).send({ message: "Missing required fields." });
        }

        // Check if user already has an active membership for this club
        const existingMembership = await membershipsCollection.findOne({
          userEmail: membership.userEmail,
          clubId: membership.clubId,
          status: { $in: ['active', 'pending'] }
        });

        if (existingMembership) {
          return res.status(409).send({
            message: `You already have an ${existingMembership.status} membership for this club.`,
            existingMembership: existingMembership
          });
        }

        if (!membership.status) {
          membership.status = 'pending';
        }

        membership.joinedAt = new Date();

        const result = await membershipsCollection.insertOne(membership);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error creating membership:", error);
        res.status(500).send({ message: "Failed to create membership." });
      }
    });

    // PATCH: Update membership status
    app.patch('/memberships/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedMembership = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: updatedMembership.status
          }
        };
        const result = await membershipsCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error updating membership:", error);
        res.status(500).send({ message: "Failed to update membership." });
      }
    });

    // DELETE: Delete membership (Leave Club)
    app.delete('/memberships/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await membershipsCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        console.error("Error deleting membership:", error);
        res.status(500).send({ message: "Failed to delete membership." });
      }
    });

    // GET: Get memberships (optionally filter by email, status, or search)
    app.get('/memberships', async (req, res) => {
      try {
        const { email, status, search } = req.query;
        let query = {};
        if (email) {
          query.userEmail = email;
        }
        if (status) {
          query.status = status;
        }
        if (search) {
          query.userEmail = { $regex: search, $options: 'i' };
        }
        const memberships = await membershipsCollection.find(query).toArray();
        res.send(memberships);
      } catch (error) {
        console.error("Error getting memberships:", error);
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

    // POST: Create a payment intent
    app.post('/create-payment-intent', async (req, res) => {
      try {
        const { price } = req.body;
        console.log("Create Payment Intent - Received Price:", price);

        const amount = parseInt(price * 100); // Convert to cents
        console.log("Calculated Amount (cents):", amount);

        if (!amount || amount < 1) {
          console.log("Invalid amount error");
          return res.status(400).send({ message: "Invalid amount" });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: 'usd',
          payment_method_types: ['card']
        });

        res.send({
          clientSecret: paymentIntent.client_secret
        });
      } catch (error) {
        console.error("Error creating payment intent:", error);
        res.status(500).send({ message: "Failed to create payment intent." });
      }
    });









    // GET: Get payments (optionally filter by email)
    app.get('/payments', verifyFBToken, async (req, res) => {
      try {
        const { email } = req.query;
        let query = {};
        console.log("headers in get payment ", req.headers.authorization);
        if (email) {
          query = { userEmail: email };
        }
        console.log("Fetching payments for query:", query);
        const payments = await paymentsCollection.find(query).toArray();
        console.log("Found payments count:", payments.length);
        res.send(payments);
      } catch (error) {
        console.error("Error fetching payments:", error);
      }
    });

    // --- Club Manager Routes ---

    // POST: Apply to be a club manager
    app.post('/club-managers', async (req, res) => {
      try {
        const application = req.body;

        // Basic validation
        if (!application.name || !application.email) {
          return res.status(400).send({ message: "Name and Email are required." });
        }

        // Check for existing application
        const existingApp = await clubManagersCollection.findOne({ email: application.email });
        if (existingApp) {
          if (existingApp.status === 'rejected') {
            // Allow re-application: Update the existing document
            const updateDoc = {
              $set: {
                name: application.name,
                reason: application.reason,
                photoURL: application.photoURL,
                status: 'pending',
                appliedAt: new Date()
              }
            };
            const result = await clubManagersCollection.updateOne({ email: application.email }, updateDoc);
            return res.status(200).send({ message: "Re-application submitted successfully.", result });
          } else if (existingApp.status === 'pending') {
            return res.status(409).send({ message: "Your application is currently pending approval." });
          } else {
            return res.status(409).send({ message: "You are already an approved manager." });
          }
        }

        // Add application details
        application.status = 'pending';
        application.appliedAt = new Date();

        const result = await clubManagersCollection.insertOne(application);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error submitting manager application:", error);
        res.status(500).send({ message: "Failed to submit application." });
      }
    });

    // GET: Get club managers (optionally filter by email, status, or search)
    app.get('/club-managers', async (req, res) => {
      try {
        const query = {}
        if (req.query.status) {
          query.status = req.query.status
        }
        if (req.query.search) {
          query.$or = [
            { name: { $regex: req.query.search, $options: 'i' } },
            { email: { $regex: req.query.search, $options: 'i' } }
          ];
        }
        const clubManagers = await clubManagersCollection.find(query).toArray();
        res.send(clubManagers);
      } catch (error) {
        console.error("Error fetching club managers:", error);
        res.status(500).send({ message: "Failed to fetch club managers." });
      }
    });

    app.patch('/club-managers/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedManager = req.body;

        // Update the application status
        const filter = { _id: new ObjectId(id) };
        const result = await clubManagersCollection.updateOne(filter, { $set: updatedManager });

        // If approved, also update the user's role in usersCollection
        if (updatedManager.status === 'approved') {
          // Find the email from the application if not passed in body, but simpler to just fetch the doc first or rely on client
          // Better: fetch the application to get the email safely
          const application = await clubManagersCollection.findOne(filter);
          if (application && application.email) {
            await usersCollection.updateOne(
              { email: application.email },
              { $set: { role: 'club_manager' } }
            );
          }
        }

        res.send(result);
      } catch (error) {
        console.error("Error updating club manager:", error);
        res.status(500).send({ message: "Failed to update club manager." });
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
