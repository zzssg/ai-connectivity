FROM node:20-bullseye-slim

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY auth.js ./
COPY server.js ./
COPY tenant-store.js ./
COPY utils.js ./

# Expose the port the app runs on
EXPOSE 8080

# Command to run the application
CMD ["node", "server.js"]