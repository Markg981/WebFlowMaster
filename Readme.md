# WebFlowMaster 🚀

**Transforming Excel Requirements into Resilient, AI-Powered Automated Tests.**

WebFlowMaster is a cutting-edge **Low-Code Test Automation Platform** designed to bridge the gap between QA requirements (often in Excel) and robust automation execution. By leveraging **GenAI (Gemini)** for self-healing and failure analysis, it drastically reduces test maintenance overhead.

---

## 🌟 Value Proposition

- **Low-Code & Visual**: Drag & drop test builder and visual element inspector.
- **Excel-Driven**: Import your existing Excel test cases and map them to automated flows instantly.
- **AI-Resilient**: Tests allow "Self-Healing". If a selector breaks, AI analyzes the DOM to find the new element automatically.
- **Smart Analysis**: Automated Root Cause Analysis (RCA) for failed tests using GenAI.

---

## 🛠 Technology Stack

- **Frontend**: Hybrid Architecture (Angular + AngularJS) for legacy compatibility and modern performance.
- **Backend**: Node.js with Express.
- **Database**: SQLite (managed via Drizzle ORM).
- **Automation Engine**: Playwright.
- **AI Engine**: Google Gemini Pro.
- **Reporting**: Allure Reports.

---

## ✨ Key Features

### 1. 🔍 Visual Inspector

Interactive overlay to detect and verify page elements (CSS/XPath) in real-time without diving into DevTools.

### 2. 🏗 Drag & Drop Builder

Construct complex test sequences visually. Reorder steps, add assertions, and configure data inputs with a simple drag-and-drop interface.

### 3. 📊 Excel Mapping Integration

Upload test case spreadsheets. The system parses columns and maps rows to automated test sequences, enabling bulk execution from business requirements.

### 4. 🧠 AI Self-Healing

Never let a UI change break your suite.

- **Detects** selector failures (Timeout/Not Found).
- **Analyzes** the new DOM structure using AI.
- **Heals** the test by effectively finding the updated element.
- **Updates** the database automatically for future runs.

---

## 🚀 Quick Start

### Prerequisites

- Node.js (v18+)
- NPM
- Gemini API Key

### Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/your-repo/WebFlowMaster.git
    cd WebFlowMaster
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    # Install playwright browsers
    npx playwright install
    ```

3.  **Configure Environment:**
    Create a `.env` file in the root:

    ```env
    GEMINI_API_KEY=your_gemini_api_key
    PORT=5000
    ```

4.  **Run the logic:**

    ```bash
    # Run database migrations
    npm run db:push

    # Start the development server
    npm run dev
    ```

5.  **Access the Dashboard:**
    Open `http://localhost:5000` in your browser.

---

## 🤝 Contributing

See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for details on extending the Self-Healing capabilities.

## 📄 Documentation

- [Architecture Guide](./docs/ARCHITECTURE.md)
- [API Reference](./docs/API_REFERENCE.md)
- [User Functional Guide](./docs/USER_GUIDE.md)
