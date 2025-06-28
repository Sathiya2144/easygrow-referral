const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const session = require("express-session");

const app = express();

// MongoDB connection (clean)
mongoose.connect(
  "mongodb+srv://easygrowuser:easygrowpass123@cluster0.bsfxlct.mongodb.net/easygrow?retryWrites=true&w=majority&appName=Cluster0"
)
  .then(() => console.log("✅ MongoDB Atlas connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Session setup
app.use(session({
  secret: "supersecretkey",
  resave: false,
  saveUninitialized: true,
}));

// Mongoose Schema
const UserSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  referrer: String,
  referralCode: String,
  txnId: String,
  paymentStatus: { type: String, default: "Pending" },
  createdAt: { type: Date, default: Date.now },
  // Profile fields
  phone: String,
  address: String
});


const User = mongoose.model("User", UserSchema);

// Generate numeric referral code
function generateReferralCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Home page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// Registration Step 1
app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "register-step1.html"));
});

app.post("/register-step1", (req, res) => {
  const { name, email, password, referrer } = req.body;

  let html = fs.readFileSync(path.join(__dirname, "views", "register-step2.html"), "utf8");
  html = html
    .replace("{{name}}", name)
    .replace("{{email}}", email)
    .replace("{{password}}", password)
    .replace("{{referrer}}", referrer || "");
  res.send(html);
});

// Registration Step 2
app.post("/register-step2", async (req, res) => {
  const { name, email, password, referrer, txnId } = req.body;
  const referralCode = generateReferralCode();

  const newUser = new User({
    name,
    email,
    password,
    referrer,
    txnId,
    referralCode,
  });
  await newUser.save();

  // Credit referrer's wallet
  if (referrer) {
    await User.findOneAndUpdate(
      { referralCode: referrer },
      { $inc: { wallet: 5 } }
    );
  }

  res.sendFile(path.join(__dirname, "views", "success.html"));
});

// Login page
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

// Login and dashboard
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email, password });
  if (!user) {
    return res.send("<h1>Invalid login details.</h1><p><a href='/login'>Try again</a></p>");
  }

  req.session.email = email;

  const referrals = await User.find({ referrer: user.referralCode });

  const referralListHtml = referrals.length
    ? `
      <ul>
        ${referrals
          .map(
            (ref) => `
            <li>
              ${ref.name} (${ref.email}) - ${ref.paymentStatus}
            </li>
          `
          )
          .join("")}
      </ul>
    `
    : "<p>No referrals yet.</p>";

  const referralCount = referrals.length;

  let html = fs.readFileSync(path.join(__dirname, "views", "dashboard.html"), "utf8");
  html = html
    .replace(/{{name}}/g, user.name)
    .replace(/{{referralCode}}/g, user.referralCode)
    .replace(/{{paymentStatus}}/g, user.paymentStatus)
    .replace(/{{paymentStatusClass}}/g, user.paymentStatus === "Verified" ? "verified" : "pending")
    .replace(/{{referralCount}}/g, referralCount)
    .replace(/{{registeredAt}}/g, user.createdAt.toLocaleString())
    .replace(/{{referralList}}/g, referralListHtml);

  res.send(html);
});

// Profile Page
app.get("/profile", async (req, res) => {
  if (!req.session.email) {
    return res.redirect("/login");
  }

  const user = await User.findOne({ email: req.session.email });
  if (!user) {
    return res.redirect("/login");
  }

  let html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Your Profile</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        background: #f2f6fa;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
      }
      .form-box {
        background: white;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 0 10px rgba(0,0,0,0.1);
        width: 400px;
      }
      h1 {
        text-align: center;
        color: #007bff;
      }
      label {
        display: block;
        margin-top: 10px;
        font-weight: bold;
      }
      input {
        width: 100%;
        padding: 10px;
        margin-top: 5px;
        border: 1px solid #ccc;
        border-radius: 4px;
      }
      button {
        width: 100%;
        padding: 12px;
        background: #007bff;
        border: none;
        color: white;
        font-size: 16px;
        border-radius: 4px;
        cursor: pointer;
        margin-top: 20px;
      }
      button:hover {
        background: #0056b3;
      }
    </style>
  </head>
  <body>
    <div class="form-box">
      <h1>Your Profile</h1>
      <form action="/profile" method="POST">
        <label>Name</label>
        <input type="text" name="name" value="${user.name}" required>
        <label>Email</label>
        <input type="email" name="email" value="${user.email}" readonly>
        <label>Phone</label>
        <input type="text" name="phone" value="${user.phone || ""}">
        <label>Address</label>
        <input type="text" name="address" value="${user.address || ""}">
        <button type="submit">Save Changes</button>
      </form>
    </div>
  </body>
  </html>
  `;

  res.send(html);
});

// Profile Update POST
app.post("/profile", async (req, res) => {
  if (!req.session.email) {
    return res.redirect("/login");
  }

  const { name, phone, address } = req.body;

  await User.findOneAndUpdate(
    { email: req.session.email },
    { name, phone, address }
  );

  res.redirect("/profile");
});


// Admin login page
app.get("/admin-login", (req, res) => {
  res.send(`
    <h1>Admin Login</h1>
    <form action="/admin-login" method="POST">
      <input type="password" name="password" placeholder="Admin Password" required />
      <button type="submit">Login</button>
    </form>
  `);
});

// Handle admin login
app.post("/admin-login", (req, res) => {
  const { password } = req.body;
  if (password === "admin123") {
    req.session.admin = true;
    return res.redirect("/admin");
  }
  res.send("<h1>Incorrect admin password.</h1><p><a href='/admin-login'>Try again</a></p>");
});

// Admin panel (protected)
app.get("/admin", async (req, res) => {
  if (!req.session.admin) {
    return res.redirect("/admin-login");
  }

  const users = await User.find();
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Admin - Registered Users</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body class="bg-light">
      <div class="container py-4">
        <h1 class="mb-4">Registered Users</h1>
        <table class="table table-bordered table-striped table-hover">
          <thead class="table-dark">
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Referrer</th>
              <th>Referral Code</th>
              <th>Transaction ID</th>
              <th>Payment Status</th>
              <th>Wallet</th>
              <th>Registered At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
  `;

  users.forEach((u) => {
    html += `
      <tr>
        <td>${u.name}</td>
        <td>${u.email}</td>
        <td>${u.referrer || "None"}</td>
        <td>${u.referralCode}</td>
        <td>${u.txnId || "Not Provided"}</td>
        <td>
          ${u.paymentStatus === "Verified"
            ? '<span class="badge bg-success">Verified</span>'
            : '<span class="badge bg-warning text-dark">Pending</span>'}
        </td>
        <td>$${u.wallet}</td>
        <td>${u.createdAt.toLocaleString()}</td>
        <td>
          ${u.paymentStatus !== "Verified"
            ? `<form action="/verify-payment" method="POST" class="d-inline">
                <input type="hidden" name="id" value="${u._id}">
                <button type="submit" class="btn btn-sm btn-success mb-1">Mark Verified</button>
              </form>`
            : ""}
          <form action="/reset-password" method="POST" class="d-inline">
            <input type="hidden" name="id" value="${u._id}">
            <button type="submit" class="btn btn-sm btn-warning mb-1">Reset Password</button>
          </form>
          <form action="/delete-user" method="POST" class="d-inline" onsubmit="return confirm('Delete this user?');">
            <input type="hidden" name="id" value="${u._id}">
            <button type="submit" class="btn btn-sm btn-danger mb-1">Delete</button>
          </form>
        </td>
      </tr>
    `;
  });

  html += `
          </tbody>
        </table>
        <a href="/admin-logout" class="btn btn-secondary mt-3">Logout</a>
      </div>
      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
    </body>
    </html>
  `;

  res.send(html);
});

// Admin logout
app.get("/admin-logout", (req, res) => {
  req.session.destroy();
  res.redirect("/admin-login");
});

// Mark payment verified
app.post("/verify-payment", async (req, res) => {
  const { id } = req.body;
  await User.findByIdAndUpdate(id, { paymentStatus: "Verified" });
  res.redirect("/admin");
});

// Reset password to '123456'
app.post("/reset-password", async (req, res) => {
  const { id } = req.body;
  await User.findByIdAndUpdate(id, { password: "123456" });
  res.redirect("/admin");
});

// Delete user
app.post("/delete-user", async (req, res) => {
  const { id } = req.body;
  await User.findByIdAndDelete(id);
  res.redirect("/admin");
});

// Start server
const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));

// Profile GET
app.get("/profile", async (req, res) => {
  // For simplicity, assuming you store logged-in user email in session
  if (!req.session.email) return res.redirect("/login");

  const user = await User.findOne({ email: req.session.email });
  if (!user) return res.redirect("/login");

  let html = fs.readFileSync(path.join(__dirname, "views", "profile.html"), "utf8");
  html = html
    .replace(/{{name}}/g, user.name)
    .replace(/{{email}}/g, user.email)
    .replace(/{{password}}/g, user.password);
  res.send(html);
});

// Profile POST
app.post("/profile", async (req, res) => {
  const { name, email, password } = req.body;
  await User.findOneAndUpdate(
    { email: req.session.email },
    { name, email, password }
  );
  req.session.email = email; // Update session if email changed
  res.redirect("/login");
});

require('dotenv').config();

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
}));

