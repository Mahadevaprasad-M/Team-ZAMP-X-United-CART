# Prasad X Cart 🛒

A full-stack **e-commerce web application** with a customer storefront and a
complete **admin dashboard**. Frontend is plain HTML/CSS/JS; backend is
Node.js + Express + Socket.IO + JWT.

> 📁 This repository is used for **code & file reference / browsing**.
> The app is not hosted online — see [Running Locally](#-running-locally) to try it on your machine.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Express](https://img.shields.io/badge/express-4.x-black)
![Socket.IO](https://img.shields.io/badge/socket.io-4.x-010101)

---

## Screenshots

### Storefront

| User Index | Products |
|---|---|
| ![Index](Images/Screenshots/User%20Index%20Page.png) | ![Products](Images/Screenshots/Product's%20Page.png) |

| Cart | Wishlist | Contact |
|---|---|---|
| ![Cart](Images/Screenshots/Cart%20Page.png) | ![Wishlist](Images/Screenshots/Wishlist%20Page.png) | ![Contact](Images/Screenshots/Contact%20Page.png) |

| Login | Register |
|---|---|
| ![Login](Images/Screenshots/User%20Login%20Page.png) | ![Register](Images/Screenshots/User%20Register%20Page.png) |

### Admin Panel

| Dashboard | Analytics | Inventory |
|---|---|---|
| ![Dashboard](Images/Screenshots/Admin%20Dashboard%20Page.png) | ![Analytics](Images/Screenshots/Admin%20Analytics%20Page.png) | ![Inventory](Images/Screenshots/Admin%20Inventory%20Page.png) |

| Alerts | Admin Login |
|---|---|
| ![Alerts](Images/Screenshots/Admin%20Alert%20Page.png) | ![Admin Login](Images/Screenshots/Admin%20Login%20Page.png) |

---

## Features

### Customer (Storefront)
- Browse products by category; banner-driven home page
- Cart, wishlist, quantity updates (localStorage + API sync)
- User registration & JWT-secured login
- Checkout & order tracking
- Product reviews
- Informational pages: about, FAQ, contact, careers, press, privacy, terms, shipping, sustainability, coming-soon

### Admin
- Real-time dashboard (Socket.IO)
- Analytics (orders, revenue, top products)
- Inventory management (CRUD products)
- Orders management & status updates
- Customers list
- Alerts system
- Settings (banners, categories)
- Separate admin auth (bcrypt + JWT)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Backend | Node.js, Express.js |
| Auth | bcryptjs, jsonwebtoken |
| Realtime | Socket.IO |
| Data Store | JSON file-based (`server/data/*.json`) |
| Dev Tools | nodemon |

---

## Folder Structure

```
prasadxcart/
├── *.html                     # Storefront pages
│   ├── index.html             # Home
│   ├── products.html          # Products listing
│   ├── product.html           # Product detail
│   ├── cart.html              # Cart
│   ├── checkout.html          # Checkout
│   ├── account.html           # User account
│   ├── login.html             # User login
│   ├── track.html             # Order tracking
│   ├── contact.html · faq.html · about.html
│   └── careers.html · press.html · privacy.html
│       terms.html · shipping.html · sustainability.html
│       coming-soon.html
│
├── admin/                     # Admin HTML pages
│   ├── index.html             # Dashboard
│   ├── analytics.html
│   ├── customers.html
│   ├── inventory.html
│   ├── orders.html
│   ├── alerts.html
│   ├── settings.html
│   └── login.html
│
├── css/
│   └── style.css
├── admin-css/
│   └── admin.css
│
├── js/                        # Storefront scripts
│   ├── auth.js  · cart.js    · data.js
│   ├── home.js  · page.js    · product.js
│   ├── products.js · store.js · ui.js · account.js
│
├── admin-js/                  # Admin scripts
│   ├── api.js           · admin-auth.js
│   ├── admin-ui.js      · admin-alerts.js
│   ├── admin-analytics.js · admin-customers.js
│   ├── admin-inventory.js · admin-orders.js
│   └── admin-settings.js
│
├── data/                      # Public seed data
│   ├── banners.json · categories.json
│   ├── products.json · reviews.json
│
├── Images/
│   └── Screenshots/           # README screenshots
│
├── server/                    # Backend
│   ├── server.js              # Express entry point
│   ├── seed.js                # Seeds JSON data
│   ├── data/                  # Persistent data
│   │   ├── users.json         · customers.json
│   │   ├── orders.json        · products.json
│   │   ├── categories.json    · banners.json
│   │   ├── reviews.json       · settings.json
│   │   └── activity-log.json
│   ├── lib/
│   │   ├── activity.js · ids.js
│   │   ├── store.js    · validate.js
│   ├── middleware/
│   │   └── auth.js
│   └── routes/
│       ├── auth.js      · catalog.js
│       ├── products.js  · orders.js
│       ├── customers.js · reviews.js
│       ├── settings.js  · analytics.js
│       └── alerts.js
│
├── package.json
├── package-lock.json
├── .gitignore
└── README.md
```

---

## 🔌 API Routes

> Base URL: `/api` · Protected routes require `Authorization: Bearer <jwt>`

### Auth — `/api/auth`
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/register` | ❌ | Register new customer |
| POST | `/login` | ❌ | Login, returns JWT |
| POST | `/logout` | ✅ | Invalidate session |
| GET  | `/me` | ✅ | Get current user |
| POST | `/admin/login` | ❌ | Admin login (bcrypt) |

### Catalog — `/api/catalog`
| Method | Endpoint | Description |
|---|---|---|
| GET | `/products` | List products (with filters) |
| GET | `/products/:id` | Product detail |
| GET | `/categories` | List categories |
| GET | `/banners` | Home page banners |
| GET | `/reviews/:productId` | Reviews for a product |

### Products (Admin) — `/api/products`
| Method | Endpoint | Auth |
|---|---|---|
| GET | `/` | List |
| POST | `/` | Create |
| PUT | `/:id` | Update |
| DELETE | `/:id` | Delete |

### Orders — `/api/orders`
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/` | ✅ user | Place order |
| GET  | `/mine` | ✅ user | My orders |
| GET  | `/` | ✅ admin | All orders |
| GET  | `/:id` | ✅ admin | Order detail |
| PUT  | `/:id/status` | ✅ admin | Update status |

### Customers (Admin) — `/api/customers`
| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | List customers |
| GET | `/:id` | Detail |
| PUT | `/:id` | Update |

### Reviews — `/api/reviews`
| Method | Endpoint | Auth |
|---|---|---|
| POST | `/` | ✅ user |
| GET  | `/:productId` | ❌ |
| DELETE | `/:id` | ✅ admin |

### Settings (Admin) — `/api/settings`
| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Get site settings |
| PUT | `/` | Update settings |
| GET | `/banners` | Get banners |
| PUT | `/banners` | Update banners |

### Analytics (Admin) — `/api/analytics`
| Method | Endpoint | Description |
|---|---|---|
| GET | `/summary` | Revenue, orders, users |
| GET | `/sales` | Time-series sales |
| GET | `/top-products` | Best sellers |

### Alerts (Admin) — `/api/alerts`
| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | List alerts |
| POST | `/` | Create alert |
| PUT | `/:id/read` | Mark as read |
| DELETE | `/:id` | Delete |

### Realtime — Socket.IO
| Event | Direction | Payload |
|---|---|---|
| `order:new` | server → admin | `{ orderId, total }` |
| `inventory:update` | server → all | `{ productId, stock }` |
| `alert:new` | server → admin | `{ message, level }` |

---