# Flamegraph Visualization Tool

This project is a web-based tool designed to create flamegraphs for visualizing latency data. The application uses a combination of D3.js, d3-flamegraph, and Google BigQuery to fetch and process data, then render flamegraphs to help understand performance bottlenecks.

## Features
- Visualize latency data using interactive flamegraphs.
- Query data from Google BigQuery.
- Responsive design with Bootstrap for clean UI.
- Dockerized for easy deployment and static server hosting.
- Timing checks implemented to measure performance of the data processing pipeline.

## Technologies Used
- **Frontend**: HTML, JavaScript, D3.js, Bootstrap, d3-flamegraph.
- **Backend**: Node.js with Express, Google BigQuery.
- **Deployment**: Docker.

## Getting Started

### Prerequisites
- Node.js (v20.12.2 or higher recommended)
- Docker
- Google Cloud Project with BigQuery enabled
- Service account key for Google BigQuery (JSON file)

### Installation

1. **Clone the repository:**
    ```bash
    git clone https://github.com/your-repo/flamegraph-viz-tool.git
    cd flamegraph-viz-tool/local # for local side
    cd flamegraph-viz-tool/server # for server side
    ```

2. **Install dependencies:**
    Run the following command in both the `local` and `server` directories to install the required packages:

    ```bash
    npm install
    ```

    Ensure the following libraries are installed:
    
    - `express`
    - `dotenv`
    - `@google-cloud/bigquery`
    - `body-parser`
    - `cors`
    - `d3-flame-graph`

    If these libraries are missing, install them manually using:

    ```bash
    npm install express dotenv @google-cloud/bigquery body-parser cors d3-flame-graph --save
    ```

3. **Add your Google Cloud Service Account JSON:**
   Place your service account JSON file in the project root and update `server.js` to reference the file:
   ```javascript
   const bigquery = new BigQuery({
     projectId: 'your-project-id',
     keyFilename: './your-service-account-key.json'
   });

3.1 **Run node server and http.server locally:**
```bash
node server.js
python3 http.server 8000
```
3.2 **Build and run the Docker container on the server:**
```bash
docker build -t flamegraph-viz-tool .
docker run -p 8000:8000 -p 3000:3000 flamegraph-viz-tool
```
Run http.server 
```bash
nohup python3 http.server 8000 > nohup.out &
```


### Usage

1. Access the application:
- Open your web browser and navigate to http://localhost:8000.
if you use local connection.

- Navigate to http://34.45.164.205:8000 
if you user server connection

2. Query and visualize data:

Use the input form to select date ranges and filter options for querying data from BigQuery.
The application will fetch data and render it as an interactive flamegraph.
3. Performance Measurement:

The application includes timing logs to measure the duration of different processes, such as data fetching and processing.


### Logs

To view server logs when running in Docker:

```bash
docker logs -f <container ID> 
```
for http server
```bash
tail -f nohup.out
```

### Troubleshooting

- CORS issues: Ensure that CORS is correctly configured in server.js to allow access from your frontend.
- OAuth errors: Make sure your service account has the necessary permissions for accessing BigQuery.

### Future Improvements

- Optimizing query execution times.
- Adding more detailed visualizations.
- Expanding support for additional data sources.

### License

This project is licensed under the MIT License - see the LICENSE file for details.

This should work well as the README for your project. Let me know if you need any more modifications!


