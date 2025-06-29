const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const QRCode = require("qrcode");
const bcrypt = require("bcrypt");

require("dotenv").config();

const app = express();

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/downloads", express.static(path.join(__dirname, "public/downloads")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallbackSecret",
    resave: false,
    saveUninitialized: true,
  })
);

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

// Home
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
  const hashedPassword = await bcrypt.hash(password, 10);

  const newUser = new User({
    name,
    email,
    password: hashedPassword,
    referrer,
    txnId,
    referralCode,
  });
  await newUser.save();

  if (referrer) {
    await User.findOneAndUpdate(
      { referralCode: referrer },
      { $inc: { wallet: 5 } }
    );
  }

  res.sendFile(path.join(__dirname, "views", "success.html"));
});

// Login
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.send("<h1>Invalid login.</h1><p><a href='/login'>Try again</a></p>");
  }

  req.session.email = email;

  // Instead of dashboard, redirect to home or downloads
  res.redirect("/downloads");
});

// Profile
app.get("/profile", async (req, res) => {
  if (!req.session.email) return res.redirect("/login");
  const user = await User.findOne({ email: req.session.email });
  if (!user) return res.redirect("/login");

  let html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Your Profile</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
  </head>
  <body class="bg-light">
  <div class="container py-5">
    <h1 class="mb-4">Your Profile</h1>
    <form action="/profile" method="POST" class="card p-4">
      <div class="mb-3">
        <label class="form-label">Name</label>
        <input class="form-control" type="text" name="name" value="${user.name}" required>
      </div>
      <div class="mb-3">
        <label class="form-label">Email</label>
        <input class="form-control" type="email" value="${user.email}" readonly>
      </div>
      <div class="mb-3">
        <label class="form-label">Phone</label>
        <input class="form-control" type="text" name="phone" value="${user.phone || ""}">
      </div>
      <div class="mb-3">
        <label class="form-label">Address</label>
        <input class="form-control" type="text" name="address" value="${user.address || ""}">
      </div>
      <button class="btn btn-primary w-100">Save Changes</button>
    </form>
  </div>
  </body>
  </html>`;
  res.send(html);
});

app.post("/profile", async (req, res) => {
  if (!req.session.email) return res.redirect("/login");
  const { name, phone, address } = req.body;
  await User.findOneAndUpdate({ email: req.session.email }, { name, phone, address });
  res.redirect("/profile");
});

// Admin Login
app.get("/admin-login", (req, res) => {
  res.send(`
    <h1>Admin Login</h1>
    <form action="/admin-login" method="POST">
      <input type="password" name="password" placeholder="Admin Password" required />
      <button type="submit">Login</button>
    </form>
  `);
});

app.post("/admin-login", (req, res) => {
  const { password } = req.body;
  if (password === "admin123") {
    req.session.admin = true;
    return res.redirect("/admin");
  }
  res.send("<h1>Incorrect admin password.</h1><p><a href='/admin-login'>Try again</a></p>");
});

app.get("/admin", async (req, res) => {
  if (!req.session.admin) return res.redirect("/admin-login");
  const users = await User.find();
  let html = `
  <!DOCTYPE html>
  <html><head>
    <title>Admin - Registered Users</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
  </head>
  <body class="bg-light">
  <div class="container py-4">
    <h1 class="mb-4">Registered Users</h1>
    <table class="table table-bordered table-hover">
      <thead><tr>
        <th>Name</th><th>Email</th><th>Referrer</th><th>Referral Code</th>
        <th>Transaction ID</th><th>Payment Status</th><th>Wallet</th><th>Registered At</th><th>Actions</th>
      </tr></thead><tbody>`;
  users.forEach(u => {
    html += `
    <tr>
      <td>${u.name}</td>
      <td>${u.email}</td>
      <td>${u.referrer || "None"}</td>
      <td>${u.referralCode}</td>
      <td>${u.txnId || "Not Provided"}</td>
      <td>${u.paymentStatus}</td>
      <td>${u.wallet ?? 0}</td>
      <td>${u.createdAt.toLocaleString()}</td>
      <td>
        ${u.paymentStatus !== "Verified" ? `
        <form action="/verify-payment" method="POST" class="d-inline">
          <input type="hidden" name="id" value="${u._id}">
          <button class="btn btn-sm btn-success">Verify</button>
        </form>` : ""}
        <form action="/reset-password" method="POST" class="d-inline">
          <input type="hidden" name="id" value="${u._id}">
          <button class="btn btn-sm btn-warning">Reset</button>
        </form>
        <form action="/delete-user" method="POST" class="d-inline" onsubmit="return confirm('Delete this user?');">
          <input type="hidden" name="id" value="${u._id}">
          <button class="btn btn-sm btn-danger">Delete</button>
        </form>
      </td>
    </tr>`;
  });
  html += `</tbody></table><a href="/admin-logout">Logout</a></div></body></html>`;
  res.send(html);
});

app.post("/verify-payment", async (req, res) => {
  await User.findByIdAndUpdate(req.body.id, { paymentStatus: "Verified" });
  res.redirect("/admin");
});

app.post("/reset-password", async (req, res) => {
  const hashedPassword = await bcrypt.hash("123456", 10);
  await User.findByIdAndUpdate(req.body.id, { password: hashedPassword });
  res.redirect("/admin");
});

app.post("/delete-user", async (req, res) => {
  await User.findByIdAndDelete(req.body.id);
  res.redirect("/admin");
});

app.get("/admin-logout", (req, res) => {
  req.session.destroy();
  res.redirect("/admin-login");
});

// QR Generator
app.get("/qr", (req, res) => {
  const html = `
  <h1>QR Code Generator</h1>
  <form action="/qr" method="POST">
    <input type="text" name="text" placeholder="Enter text or URL" required>
    <button>Generate</button>
  </form>`;
  res.send(html);
});

app.post("/qr", async (req, res) => {
  const text = req.body.text;
  const qrDataUrl = await QRCode.toDataURL(text);
  res.send(`<h1>QR Code</h1><img src="${qrDataUrl}"><a href="/qr">Generate Another</a>`);
});

// Downloads Hub
app.get("/downloads", (req, res) => {
  const files = [
    { name: "Resume Template", file: "modern-resume.pdf", desc: "Professional resume" },
    { name: "Budget Planner", file: "budget-planner.xlsx", desc: "Simple Excel planner" },
    { name: "Study Timetable", file: "study-timetable.pdf", desc: "Plan study schedule" },
  ];
  let html = `<h1>Download Hub</h1><ul>`;
  files.forEach(f => {
    html += `<li><a href="/downloads/${f.file}" download>${f.name}</a> - ${f.desc}</li>`;
  });
  html += `</ul>`;
  res.send(html);
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
