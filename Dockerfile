# Use an official Python runtime as a parent image
FROM python:3.11-slim-buster

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set work directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    netcat \
    curl \
    postgresql-client \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install LocalXpose
RUN ARCH=$(uname -m); \
    if [ "$ARCH" = "x86_64" ]; then \
        curl -o /usr/local/bin/loclx https://api.localxpose.io/api/v2/downloads/loclx-linux-amd64.bin; \
    elif [ "$ARCH" = "aarch64" ]; then \
        curl -o /usr/local/bin/loclx https://api.localxpose.io/api/v2/downloads/loclx-linux-arm64.bin; \
    else \
        echo "Unsupported architecture: $ARCH"; \
        exit 1; \
    fi && \
    chmod +x /usr/local/bin/loclx

# Install Python dependencies
COPY requirements.txt /app/
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy project
COPY . /app/

# Make start script executable
RUN chmod +x /app/start-app.sh

# Expose port 8085
EXPOSE 8085

# Run the application
CMD ["/app/start-app.sh"]
