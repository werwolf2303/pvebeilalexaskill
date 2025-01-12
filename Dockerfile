FROM node:18-alpine
RUN apk add --no-cache python3 py3-pip
RUN pip install requests
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8080
CMD ["node", "src/index.js"]
