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
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

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
