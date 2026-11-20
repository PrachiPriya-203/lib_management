const path = require('path');
const express = require("express");
const fs = require("fs");
const bcrypt = require("bcrypt");

const app = express();

app.use(express.json());
app.use(express.static("public", { index: false }));

// Use lowercase path to match the actual folder name on disk
const DATA_DIR = path.join(__dirname, "data files");
const USERS = path.join(DATA_DIR, "users.json");
const BOOKS = path.join(DATA_DIR, "books.json");
const REQUESTS = path.join(DATA_DIR, "requests.json");

// ================= FILE HELPERS =================

function readFile(file) {
    try {
        if (!fs.existsSync(file)) return [];
        const content = fs.readFileSync(file, "utf8");
        return JSON.parse(content);
    } catch (err) {
        console.error(`Error reading file ${file}:`, err.message);
        return [];
    }
}

function writeFile(file, data) {
    try {
        // Ensure the data directory exists
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(`Error writing file ${file}:`, err.message);
        throw err;
    }
}

// Strip sensitive fields before storing in requests/issuedTo
function sanitizeStudent(student) {
    const { password, ...safe } = student;
    return safe;
}

// ================= 🔐 AUTH =================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// REGISTER
app.post("/register", async (req, res) => {
    try {
        const { name, roll, dept, phone, password, role } = req.body;

        if (!name || !roll || !password || !role) {
            return res.status(400).send("Missing required fields.");
        }

        const users = readFile(USERS);

        // Check for duplicate roll + role
        const existing = users.find(u => u.roll === roll && u.role === role);
        if (existing) {
            return res.status(409).send("User with this ID and role already exists.");
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        users.push({
            id: Date.now().toString(),
            name,
            roll,
            dept: dept || null,
            phone: phone || null,
            password: hashedPassword,
            role
        });

        writeFile(USERS, users);
        res.send("Registered");
    } catch (err) {
        console.error("Register error:", err);
        res.status(500).send("Server error during registration.");
    }
});

// LOGIN
app.post("/login", async (req, res) => {
    try {
        const { roll, password, role } = req.body;

        if (!roll || !password || !role) {
            return res.status(400).send("Missing credentials.");
        }

        const users = readFile(USERS);

        // Look for a user that matches BOTH the roll number AND the selected role
        const user = users.find(u => u.roll === roll && u.role === role);

        if (!user) return res.status(401).send("User not found for this role.");

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).send("Wrong Password");

        // Return user WITHOUT the password field
        const { password: _, ...safeUser } = user;
        res.json(safeUser);
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).send("Server error during login.");
    }
});

// ================= 📚 BOOK =================

// ADD BOOK
app.post("/addBook", (req, res) => {
    try {
        const { title, author, dept, qty } = req.body;

        if (!title || !author || !dept || !qty) {
            return res.status(400).send("Missing required book fields.");
        }

        const books = readFile(BOOKS);

        books.push({
            id: Date.now().toString(),
            title,
            author,
            dept,
            qty: Number(qty),
            issued: 0,
            issuedTo: []
        });

        writeFile(BOOKS, books);
        res.send("Added");
    } catch (err) {
        console.error("addBook error:", err);
        res.status(500).send("Failed to add book.");
    }
});

// EDIT BOOK
app.put("/edit/:id", (req, res) => {
    try {
        const { title, author, dept, qty } = req.body;
        let books = readFile(BOOKS);

        const idx = books.findIndex(b => b.id === req.params.id);
        if (idx === -1) return res.status(404).send("Book not found.");

        books[idx] = {
            ...books[idx],
            title: title || books[idx].title,
            author: author || books[idx].author,
            dept: dept || books[idx].dept,
            qty: qty !== undefined ? Number(qty) : books[idx].qty
        };

        writeFile(BOOKS, books);
        res.send("Updated");
    } catch (err) {
        console.error("editBook error:", err);
        res.status(500).send("Failed to update book.");
    }
});

// GET BOOKS
app.get("/books", (req, res) => {
    try {
        res.json(readFile(BOOKS));
    } catch (err) {
        console.error("getBooks error:", err);
        res.status(500).json([]);
    }
});

// ================= 📩 REQUEST SYSTEM =================

// ISSUE REQUEST
app.post("/request/:bookId", (req, res) => {
    try {
        const requests = readFile(REQUESTS);
        const student = sanitizeStudent(req.body);

        // Prevent duplicate pending issue requests for same book+student
        const duplicate = requests.find(r =>
            r.bookId === req.params.bookId &&
            r.student.roll === student.roll &&
            r.type === "issue" &&
            r.status === "pending"
        );
        if (duplicate) return res.send("duplicate");

        requests.push({
            id: Date.now().toString(),
            type: "issue",
            status: "pending",
            bookId: req.params.bookId,
            student
        });

        writeFile(REQUESTS, requests);
        res.send("Request Sent");
    } catch (err) {
        console.error("request error:", err);
        res.status(500).send("Failed to create request.");
    }
});

// RETURN REQUEST
app.post("/returnRequest/:bookId", (req, res) => {
    try {
        const requests = readFile(REQUESTS);
        const student = sanitizeStudent(req.body);

        // Prevent duplicate pending return requests
        const duplicate = requests.find(r =>
            r.bookId === req.params.bookId &&
            r.student.roll === student.roll &&
            r.type === "return" &&
            r.status === "pending"
        );
        if (duplicate) return res.send("duplicate");

        requests.push({
            id: Date.now().toString(),
            type: "return",
            status: "pending",
            bookId: req.params.bookId,
            student
        });

        writeFile(REQUESTS, requests);
        res.send("Return Request Sent");
    } catch (err) {
        console.error("returnRequest error:", err);
        res.status(500).send("Failed to create return request.");
    }
});

// GET ALL REQUESTS (ADMIN) — only pending
app.get("/requests", (req, res) => {
    try {
        const requests = readFile(REQUESTS);
        res.json(requests.filter(r => r.status === "pending"));
    } catch (err) {
        console.error("getRequests error:", err);
        res.status(500).json([]);
    }
});

// GET USER REQUESTS (STUDENT) — all statuses
// Use query parameter to handle roll numbers containing slashes (e.g. NIT/2023/1745)
app.get("/myRequests", (req, res) => {
    try {
        const roll = req.query.roll;
        if (!roll) return res.status(400).json([]);

        const requests = readFile(REQUESTS);
        const my = requests.filter(r =>
            r.student && r.student.roll === roll
        );
        res.json(my);
    } catch (err) {
        console.error("myRequests error:", err);
        res.status(500).json([]);
    }
});

// ================= ✅ APPROVAL ENGINE =================

app.post("/approve/:reqId", (req, res) => {
    try {
        let requests = readFile(REQUESTS);
        let books = readFile(BOOKS);

        const reqItem = requests.find(r => r.id === req.params.reqId);
        if (!reqItem) return res.status(404).send("No request found.");

        books = books.map(b => {
            if (b.id === reqItem.bookId) {

                // ISSUE
                if (reqItem.type === "issue") {
                    if (b.qty > b.issued) {
                        b.issued++;
                        if (!Array.isArray(b.issuedTo)) b.issuedTo = [];
                        b.issuedTo.push({
                            ...sanitizeStudent(reqItem.student),
                            issuedAt: Date.now()
                        });
                    }
                }

                // RETURN
                if (reqItem.type === "return") {
                    if (b.issued > 0) {
                        b.issued--;
                        b.issuedTo = (b.issuedTo || []).filter(
                            s => s.roll !== reqItem.student.roll
                        );
                    }
                }
            }
            return b;
        });

        // Mark as approved (do not delete)
        requests = requests.map(r =>
            r.id === req.params.reqId ? { ...r, status: "approved" } : r
        );

        writeFile(BOOKS, books);
        writeFile(REQUESTS, requests);

        res.send("Approved");
    } catch (err) {
        console.error("approve error:", err);
        res.status(500).send("Failed to approve request.");
    }
});

// ❌ CANCEL / REJECT
app.post("/cancel/:reqId", (req, res) => {
    try {
        let requests = readFile(REQUESTS);

        const exists = requests.find(r => r.id === req.params.reqId);
        if (!exists) return res.status(404).send("No request found.");

        // Mark as rejected instead of deleting
        requests = requests.map(r =>
            r.id === req.params.reqId ? { ...r, status: "rejected" } : r
        );

        writeFile(REQUESTS, requests);
        res.send("Cancelled");
    } catch (err) {
        console.error("cancel error:", err);
        res.status(500).send("Failed to reject request.");
    }
});

// ================= 📊 ANALYTICS =================

app.get("/analytics", (req, res) => {
    try {
        const books = readFile(BOOKS);

        const studentMap = {};
        const bookMap = {};

        books.forEach(b => {
            bookMap[b.title] = (bookMap[b.title] || 0) + b.issued;

            (b.issuedTo || []).forEach(s => {
                if (!s.roll) return;
                if (!studentMap[s.roll]) {
                    studentMap[s.roll] = {
                        name: s.name,
                        roll: s.roll,
                        dept: s.dept,
                        count: 0
                    };
                }
                studentMap[s.roll].count++;
            });
        });

        const topStudents = Object.values(studentMap)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        const topBooks = Object.entries(bookMap)
            .map(([title, count]) => ({ title, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        res.json({ topStudents, topBooks });
    } catch (err) {
        console.error("analytics error:", err);
        res.status(500).json({ topStudents: [], topBooks: [] });
    }
});

// ================= START =================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
    console.log(`🚀 Server is running on http://localhost:${PORT}`)
);
