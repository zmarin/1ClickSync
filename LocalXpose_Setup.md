# LocalXpose Setup for ZTsync Python Project

This document outlines the process of setting up LocalXpose to expose our Flask application running on localhost to the internet using the custom domain www.1clicksync.com.

## Prerequisites

- Ubuntu Server
- Flask application running on localhost:8085
- LocalXpose account and CLI tool installed
- Custom domain (1clicksync.com) registered with Namecheap

## Steps

1. **Install LocalXpose**
   
   Download and install LocalXpose CLI tool from the official website.

2. **Login to LocalXpose**

   ```
   ./loclx login <your_access_token>
   ```

3. **Reserve Custom Domain**

   ```
   ./loclx domain reserve --domain www.1clicksync.com
   ```

   This command will provide a CNAME record to add to your DNS settings.

4. **Update DNS Settings in Namecheap**

   In your Namecheap DNS settings:
   - Add a CNAME record:
     - Type: CNAME Record
     - Host: www
     - Value: [LocalXpose CNAME] (e.g., 3ppthejsotx4rui.cname.loclx.io)
     - TTL: Automatic
   - Add an A record:
     - Type: A Record
     - Host: @
     - Value: 3.135.113.135 (LocalXpose's IP)
     - TTL: Automatic
   - Add a URL Redirect Record:
     - Type: URL Redirect Record
     - Host: @
     - Value: http://www.1clicksync.com/
     - TTL: Automatic

   This setup ensures that both www.1clicksync.com and 1clicksync.com (without www) will work, with the root domain redirecting to the www subdomain.

5. **Set Up SystemD Service**

   Create a service file at `/etc/systemd/system/localxpose.service` with the following content:

   ```
   [Unit]
   Description=LocalXpose Tunnel Service
   After=network.target

   [Service]
   ExecStart=/home/zmarin/Projects/ZTsync_python/loclx tunnel http --to localhost:8085 --reserved-domain www.1clicksync.com --https-redirect
   Restart=always
   User=zmarin

   [Install]
   WantedBy=multi-user.target
   ```

6. **Enable and Start the Service**

   ```
   sudo systemctl daemon-reload
   sudo systemctl enable localxpose.service
   sudo systemctl start localxpose.service
   ```

## Verification

- Check if the tunnel is running: `sudo systemctl status localxpose.service`
- Verify HTTPS redirection: Visit https://www.1clicksync.com and http://1clicksync.com in a web browser

## Notes

- LocalXpose provides free SSL/TLS certificates for custom domains.
- The tunnel will automatically restart if the server reboots.
- Monitor the LocalXpose logs for any issues: `sudo journalctl -u localxpose.service`

Remember to keep your LocalXpose CLI tool updated and periodically check for any changes in the LocalXpose service that might affect your setup.

## Troubleshooting

If you encounter any issues:

1. Check the service status: `sudo systemctl status localxpose.service`
2. View the logs: `sudo journalctl -u localxpose.service -n 50`
3. Ensure your Flask application is running on localhost:8085
4. Verify your DNS settings are correct in Namecheap

## Updating Configuration

If you need to make changes to the LocalXpose configuration:

1. Edit the service file: `sudo nano /etc/systemd/system/localxpose.service`
2. Reload the systemd daemon: `sudo systemctl daemon-reload`
3. Restart the service: `sudo systemctl restart localxpose.service`