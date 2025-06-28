const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const session = require("express-session");

// Load environment variables
require("dotenv").config();

const app = express();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Sessions
app.use(session({
  secret: process.env.SESSION_SECRET || "fallbackSecret",
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
  wallet: { type: Number, default: 0 },
  phone: String,
  address: String,
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
  const referralCount = referrals.length;

  const referralListHtml = referrals.length
    ? `<ul>${referrals.map(ref => `<li>${ref.name} (${ref.email}) - ${ref.paymentStatus}</li>`).join("")}</ul>`
    : "<p>No referrals yet.</p>";

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
  </head>
  <body>
    <div>
      <h1>Your Profile</h1>
      <form action="/profile" method="POST">
        <label>Name</label>
        <input type="text" name="name" value="${user.name}" required>
        <label>Email</label>
        <input type="email" value="${user.email}" readonly>
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
  if (!req.session.email) return res.redirect("/login");

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

// Admin panel
app.get("/admin", async (req, res) => {
  if (!req.session.admin) return res.redirect("/admin-login");

  const users = await User.find();
  let html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Admin - Registered Users</title>
  </head>
  <body>
    <h1>Registered Users</h1>
    <table border="1">
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
  `;

  users.forEach(u => {
    html += `
    <tr>
      <td>${u.name}</td>
      <td>${u.email}</td>
      <td>${u.referrer || "None"}</td>
      <td>${u.referralCode}</td>
      <td>${u.txnId || "Not Provided"}</td>
      <td>${u.paymentStatus}</td>
      <td>${u.wallet}</td>
      <td>${u.createdAt.toLocaleString()}</td>
      <td>
        ${u.paymentStatus !== "Verified" ? `
        <form action="/verify-payment" method="POST" style="display:inline">
          <input type="hidden" name="id" value="${u._id}">
          <button type="submit">Mark Verified</button>
        </form>` : ""}
        <form action="/reset-password" method="POST" style="display:inline">
          <input type="hidden" name="id" value="${u._id}">
          <button type="submit">Reset Password</button>
        </form>
        <form action="/delete-user" method="POST" style="display:inline" onsubmit="return confirm('Delete this user?');">
          <input type="hidden" name="id" value="${u._id}">
          <button type="submit">Delete</button>
        </form>
      </td>
    </tr>
    `;
  });

  html += `</table><a href="/admin-logout">Logout</a></body></html>`;
  res.send(html);
});

// Mark payment verified
app.post("/verify-payment", async (req, res) => {
  const { id } = req.body;
  await User.findByIdAndUpdate(id, { paymentStatus: "Verified" });
  res.redirect("/admin");
});

// Reset password to "123456"
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

// Admin logout
app.get("/admin-logout", (req, res) => {
  req.session.destroy();
  res.redirect("/admin-login");
});

// Start server
const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
