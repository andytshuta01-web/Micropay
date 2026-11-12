# Micropay

MicroPay is a financial firewall for AI agents. The agent (Groq, tool-calling) explores resources and can request a payment with a justification; it can never trigger one itself. A **policy engine evaluates the request before it becomes a PayPal Sandbox transfer.

Project built for the PayPal AI Hackathon 2026 — “Build What’s Next with PayPal and AI”.

The principle

The AI agent can never trigger a payment directly. It submits a request with a justification and a confidence level. The policy engine checks the remaining budget (exceeding it = refusal), then evaluates the following controls:

Is the provider on the allowed list?
Is the amount below the auto-approval threshold?
Does the recent payment frequency respect the set limit?
Does the confidence level declared by the agent meet the required minimum? (The justification text is logged, not semantically evaluated.)

A policy rule that isn’t satisfied — provider off-list, frequency, confidence, or threshold — puts the request into pending human validation, even if its amount is low. A request that exceeds the remaining budget is refused. Compliant requests are executed via the PayPal Payouts API in Sandbox; a pending request triggers no transfer until it’s approved from the dashboard.

The MicroPay workspace brings together mission creation and tracking, the dashboard, purchase requests, human validations, and transaction receipts that are printable or savable as PDF from the browser. Resources and providers remain simulated.

Current limitations
There is no account or authentication. The server listens only on 127.0.0.1: the app is intended for local use, not for shared or internet-exposed deployment.
Available resources are a fictional catalog defined in backend/src/providers.js, not real paywalls or services.
Payments go through PayPal Sandbox when credentials are configured. They are not production transfers.
The Invoices page prepares a printable receipt; the browser’s dialog allows saving it as PDF. This is not a tax invoice.
Stack
Layer	Tech
Frontend	HTML + CSS + vanilla JavaScript
Backend	Node.js (Express)
AI Agent	Groq (tool-calling), model llama-3.3-70b-versatile
Payment	PayPal Sandbox — Payouts API
Persistence	JSON file (backend/data/db.json)
Project structure
micropay/
  backend/
    src/
      server.js          Express server and local web interface
      agent.js            Groq reasoning loop (tool-calling)
      policyEngine.js      spending policy engine
      paypal.js            PayPal module (Payouts API sandbox)
      providers.js         simulated providers and resources
      store.js             JSON persistence
      routes/missions.js   API endpoints
    .env.example
    package.json
  frontend/
    index.html          animated home page
    workspace.html      control space, missions, purchases and receipts
    css/theme.css         dark theme and Syne / DM Sans typography
    css/home.css          home page styles
    css/workspace.css     control space styles
    js/api.js             backend calls
    js/workspace.js       dashboard, purchases and receipts
    js/theme.js           theme toggle
    js/theme-init.js      applies the remembered theme
  README.md
Installation
Running MicroPay
bash
cd micropay/backend
npm install

Create backend/.env and fill in the required credentials:

GROQ_API_KEY=your_groq_key
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_client_secret
Free Groq key: https://console.groq.com
PayPal sandbox app (client id/secret): https://developer.paypal.com/dashboard/applications

Start the backend, which also serves the frontend:

bash
npm start

Open http://localhost:4000. The health API route is available at http://localhost:4000/api/health. The server is bound to 127.0.0.1 and is not intended for public use without authentication.

Usage
From the home page, click Get Started to open the MicroPay workspace, no sign-up or login required.
Create a mission and define its budget and spending rules.
Track requests in Purchases and manually approve or deny those that get escalated.
Review completed transactions in Invoices; print a receipt or save it as PDF from the browser.
Simulated providers

To keep the demo reliable, MicroPay doesn’t query real paywalls: backend/src/providers.js defines 5 fictional resources across 4 providers, with varied risk profiles so the policy engine can make different decisions.

Why the Payouts API rather than Checkout

A payment triggered by an autonomous agent is an outbound money transfer, with no human buyer available to interactively approve a transaction. PayPal’s Payouts API is built for that: a direct transfer to the recipient’s email, triggered server-side. It’s the technical choice consistent with the agentic commerce concept.

Target categories (PayPal AI Hackathon)
Best Overall
Best Use of Agentic Commerce
Best Use of PayPal + AI
License

MIT
