# Jerry AI Backend

This is the backend server for Jerry AI, a chatbot powered by Google Gemini and Firebase.

## Features
- AI-powered chat using **Gemini 2.0 Flash**.
- Authentication managed via **Firebase**.
- Real-time streaming responses.
- Chat history stored in **Firebase Firestore**.

## Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [Firebase Project](https://console.firebase.google.com/)
- [Gemini API Key](https://aistudio.google.com/app/apikey)

## Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd jerry-api
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Configuration:**
   Create a `.env.development` file in the root directory and add your credentials:
   ```env
   PORT=5000
   GEMINI_API_KEY=your_gemini_api_key
   FRONTEND_URL=http://localhost:5173

   # Firebase Configuration
   FIREBASE_API_KEY=your_firebase_api_key
   FIREBASE_PROJECT_ID=your_firebase_project_id
   FIREBASE_CLIENT_EMAIL=your_firebase_client_email
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
   ```

4. **Run the server:**
   - For development:
     ```bash
     npm run dev
     ```
   - For production:
     ```bash
     npm start
     ```

## API Endpoints

### Auth
- `POST /api/auth/register` - Register a new user.
- `POST /api/auth/login` - Login endpoint (Note: Login is typically handled on the frontend via Firebase SDK).

### Chat
- `POST /api/chat/new` - Start a new chat and stream response.
- `GET /api/chat/all` - Get all chats for a user.
- `GET /api/chat/:chatId` - Get messages for a specific chat.
- `DELETE /api/chat/:chatId` - Delete a chat.
- `POST /api/chat/:chatId/continue` - Continue an existing chat.

## Technologies Used
- Express.js
- Firebase Admin SDK
- Google Generative AI (@google/generative-ai)
- Cors
- Dotenv
