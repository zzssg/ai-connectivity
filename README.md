# AI Connectivity Project

## Overview
The AI Connectivity project is a Node.js application that integrates with Google Cloud's Vertex AI to generate responses based on user input. It sets up an Express server and provides an endpoint for handling requests.

## File Structure
```
ai-connectivity
├── server.js          # Main entry point of the application
├── auth.js            # Middleware for authenticating requests
├── model-mapper.js    # Maps model names to Vertex AI model names
├── package.json       # npm configuration file
├── package-lock.json  # Locks versions of dependencies
├── Dockerfile         # Instructions for building a Docker image
├── .dockerignore      # Files to ignore when building the Docker image
├── .env.example       # Example environment variables
└── README.md          # Documentation for the project
```

## Getting Started

### Prerequisites
- Node.js (version 20 or higher)
- npm (Node package manager)
- Google Cloud account with Vertex AI access

### Installation
1. Clone the repository:
   ```
   git clone <repository-url>
   cd ai-connectivity
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Set up environment variables:
   - Copy `.env.example` to `.env` and fill in the required values.

### Running the Application
To start the server, run:
```
node server.js
```
The server will listen on port 8080.

### API Endpoint
- **POST /v1/responses**: This endpoint accepts user input and returns a generated response from Vertex AI.

### Docker
To build the Docker image, run:
```
docker build -t ai-connectivity .
```

To run the Docker container:
```
docker run -p 8080:8080 --env-file .env ai-connectivity
```

## License
This project is licensed under the MIT License. See the LICENSE file for details.