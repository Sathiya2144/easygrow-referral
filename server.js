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

app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallbackSecret",
    resave: false,
    saveUninitialized: true,
  })
);

// Mongoose User Schema
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

// Home Page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// Register Step 1
app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "register-step1.html"));
});

app.post("/register-step1", (req, res) => {
  const { name, email, password, confirmPassword, referrer } = req.body;

  if (password !== confirmPassword) {
    return res.send("<h1>Passwords do not match.</h1><p><a href='/register'>Try again</a></p>");
  }

  let html = fs.readFileSync(path.join(__dirname, "views", "register-step2.html"), "utf8");
  html = html
    .replace("{{name}}", name)
    .replace("{{email}}", email)
    .replace("{{password}}", password)
    .replace("{{referrer}}", referrer || "");
  res.send(html);
});

// Register Step 2
app.post("/register-step2", async (req, res) => {
  const { name, email, password, referrer, txnId } = req.body;

  const existing = await User.findOne({ email });
  if (existing) {
    return res.send("<h1>Email already registered.</h1><p><a href='/login'>Login here</a></p>");
  }

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
    return res.send("<h1>Invalid email or password.</h1><p><a href='/login'>Try again</a></p>");
  }

  req.session.email = email;
  res.redirect("/dashboard");
});

// Profile
app.get("/profile", async (req, res) => {
  if (!req.session.email) return res.redirect("/login");
  const user = await User.findOne({ email: req.session.email });
  if (!user) return res.redirect("/login");

  let html = fs.readFileSync(path.join(__dirname, "views", "profile.html"), "utf8");
  html = html
    .replace("{{name}}", user.name)
    .replace("{{email}}", user.email)
    .replace("{{phone}}", user.phone || "")
    .replace("{{address}}", user.address || "");
  res.send(html);
});

app.post("/profile", async (req, res) => {
  if (!req.session.email) return res.redirect("/login");
  const { name, phone, address } = req.body;
  await User.findOneAndUpdate({ email: req.session.email }, { name, phone, address });
  res.redirect("/profile");
});

// Dashboard
app.get("/dashboard", async (req, res) => {
  if (!req.session.email) return res.redirect("/login");
  const user = await User.findOne({ email: req.session.email });
  if (!user) return res.redirect("/login");

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
    .replace(/{{wallet}}/g, user.wallet ?? 0)
    .replace(/{{referralCount}}/g, referralCount)
    .replace(/{{registeredAt}}/g, user.createdAt.toLocaleString())
    .replace(/{{referralList}}/g, referralListHtml);
  res.send(html);
});

// QR Generator
app.get("/qr", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "qr.html"));
});

app.post("/qr", async (req, res) => {
  const text = req.body.text;
  const qrDataUrl = await QRCode.toDataURL(text);
  res.send(`
    <h1>QR Code</h1>
    <img src="${qrDataUrl}" alt="QR Code">
    <p><a href="/qr">Generate Another</a></p>
  `);
});

// Admin Login
app.get("/admin-login", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin-login.html"));
});

app.post("/admin-login", (req, res) => {
  if (req.body.password === "admin1234") {
    req.session.admin = true;
    return res.redirect("/admin");
  }
  res.send("<h1>Incorrect admin password.</h1><p><a href='/admin-login'>Try again</a></p>");
});

app.get("/admin", async (req, res) => {
  if (!req.session.admin) return res.redirect("/admin-login");
  const users = await User.find();
  let html = fs.readFileSync(path.join(__dirname, "views", "admin.html"), "utf8");

let tableRows = users.map(u => `
  <tr>
    <td>${u.name}</td>
    <td>${u.email}</td>
    <td>${u.referralCode}</td>
    <td>${u.txnId || "Not Provided"}</td>
    <td>${u.wallet ?? 0}</td>
    <td>${u.paymentStatus}</td>
    <td>
      ${u.paymentStatus !== "Verified" ? `<form action="/verify-payment" method="POST" style="display:inline">
        <input type="hidden" name="id" value="${u._id}">
        <button class="btn btn-success btn-sm">Verify</button>
      </form>` : ""}
      <form action="/reset-password" method="POST" style="display:inline">
        <input type="hidden" name="id" value="${u._id}">
        <button class="btn btn-warning btn-sm">Reset</button>
      </form>
      <form action="/delete-user" method="POST" style="display:inline" onsubmit="return confirm('Delete this user?');">
        <input type="hidden" name="id" value="${u._id}">
        <button class="btn btn-danger btn-sm">Delete</button>
      </form>
    </td>
  </tr>
`).join("");


  html = html.replace("{{tableRows}}", tableRows);
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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
