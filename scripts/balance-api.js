const https = require('https');

const DEFAULT_HOSTNAME =
  'studio--studio-8208926735-5ea4c.us-central1.hosted.app';

function getConfig() {
  const apiKey = process.env.FIRESTORE_READ_API_KEY;
  if (!apiKey) {
    throw new Error(
      'FIRESTORE_READ_API_KEY is not set. Provide it through the environment.'
    );
  }

  return {
    apiKey,
    hostname: process.env.BALANCE_API_HOSTNAME || DEFAULT_HOSTNAME,
  };
}

function makeRequest(method, path, body = null) {
  const { apiKey, hostname } = getConfig();

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname,
        path,
        method,
        headers: {
          'x-firedb-key': apiKey,
          'Content-Type': 'application/json',
        },
      },
      (response) => {
        let rawBody = '';
        response.on('data', (chunk) => {
          rawBody += chunk;
        });
        response.on('end', () => {
          let parsedBody;
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            parsedBody = rawBody;
          }

          if (
            response.statusCode &&
            (response.statusCode < 200 || response.statusCode >= 300)
          ) {
            const message =
              parsedBody?.error ||
              `Balance API request failed with status ${response.statusCode}.`;
            reject(new Error(message));
            return;
          }

          resolve(parsedBody);
        });
      }
    );

    request.on('error', reject);
    if (body) {
      request.write(JSON.stringify(body));
    }
    request.end();
  });
}

function fetchData(path) {
  return makeRequest('GET', path);
}

module.exports = { fetchData, makeRequest };
