# Updated Project Documentation

## Table of Contents
- [Introduction](#introduction)
- [Project Overview](#project-overview)
- [System Architecture](#system-architecture)
- [Technical Specifications](#technical-specifications)
- [Detailed Features and Functionalities](#detailed-features-and-functionalities)
- [Onboarding and Dashboard Integration](#onboarding-and-dashboard-integration)
- [Subscription Plans and Limitations](#subscription-plans-and-limitations)
- [Security and Compliance](#security-and-compliance)
- [API Integration Details](#api-integration-details)
- [User Interface Design](#user-interface-design)
- [Testing and Quality Assurance](#testing-and-quality-assurance)
- [Deployment and Maintenance](#deployment-and-maintenance)
- [Documentation and Support](#documentation-and-support)
- [Conclusion](#conclusion)
- [Appendices](#appendices)

## Introduction
This document provides an updated and improved overview of ZTsync, a web application designed to synchronize tasks and project data between Zoho Projects and Todoist. The improvements include:

- Simplification of the application architecture by working without Flask blueprints.
- Integration of the onboarding process into the dashboard, where each step unlocks the next feature.

This documentation reflects these changes and provides detailed insights into the project, including system architecture, technical specifications, and implementation details.

## Project Overview
### Purpose and Scope
ZTsync aims to provide seamless integration between Zoho Projects and Todoist, enabling users to synchronize tasks, subtasks, comments, statuses, and other relevant data. By automating synchronization, the application reduces manual effort and enhances project management efficiency.

### Goals and Objectives
- **Simplified Architecture**: Streamline the application by eliminating unnecessary complexity.
- **Integrated Onboarding**: Incorporate the onboarding process into the dashboard, unlocking features progressively.
- **Seamless Integration**: Allow two-way synchronization between Zoho Projects and Todoist.
- **User-Friendly Experience**: Provide an intuitive interface for configuration and management.
- **Customization**: Enable users to customize status mappings and synchronization settings.
- **Scalability**: Design the system to handle a growing user base and data volume.
- **Security**: Ensure data protection and compliance with relevant regulations.
- **Monetization**: Implement subscription plans with Stripe integration for payment processing.

## System Architecture
### High-Level Architecture Diagram
*(As images cannot be displayed, please imagine a simplified diagram illustrating the components and their interactions without the use of Flask blueprints.)*

### Components Description
- **Frontend Application**
  - Built using HTML, Tailwind CSS, JavaScript, and Jinja2 templating.
  - Handles user interactions and displays data.
  - Provides the integrated onboarding process within the dashboard.

- **Backend API Server**
  - Developed using Python 3.8+ and Flask framework without blueprints.
  - Manages business logic, API integrations, and database interactions.
  - Handles user authentication, synchronization logic, and subscription management.

- **Database**
  - Uses PostgreSQL for relational data storage.
  - Stores user data, OAuth tokens, sync configurations, mappings, and logs.

- **Authentication Service**
  - Manages user authentication and authorization.
  - Handles OAuth2 flows with Zoho Projects and Todoist.
  - Implements JWT for session management.

- **Synchronization Engine**
  - Handles synchronization logic between Zoho Projects and Todoist.
  - Manages ID mappings and data consistency.
  - Simplified implementation without the need for asynchronous task processing initially.

- **Subscription Management**
  - Integrates with Stripe API for payment processing.
  - Manages subscription plans and user billing.

- **Deployment Environment**
  - Uses Docker for containerization.
  - Prepared for scalability and cloud deployment.

## Technical Specifications
### Technology Stack
**Backend**
- Language: Python 3.8+
- Framework: Flask (without blueprints)
- ORM: SQLAlchemy
- Database: PostgreSQL

**Frontend**
- Markup and Styling: HTML and Tailwind CSS
- Scripting: JavaScript
- Templating Engine: Jinja2

**Authentication**
- Third-Party Authentication: OAuth2 (Zoho and Todoist)
- Session Management: JWT (JSON Web Tokens)

**API Integration**
- HTTP Requests: requests library

**Payment Processing**
- Stripe API: For subscription management

**Deployment**
- Containerization: Docker
- Cloud Deployment: Prepared for AWS, Heroku, or similar platforms

**Testing**
- Unit and Integration Testing: Pytest

**Logging**
- Logging Module: Python's built-in logging module

### Simplification Highlights
- **No Flask Blueprints**: The application will be structured without blueprints, simplifying the codebase.
- **Integrated Onboarding**: Onboarding steps are part of the dashboard, eliminating separate onboarding routes.

## Detailed Features and Functionalities
### Two-Way Synchronization
**Description**: Synchronizes tasks and subtasks between Zoho Projects and Todoist bidirectionally, ensuring changes in one platform are reflected in the other.

**Key Functionalities**:
- Task Synchronization: Create, update, and delete tasks based on detected changes.
- Subtask Handling: Maintain parent-child relationships for subtasks.
- Comments Synchronization: Sync comments associated with tasks.
- Status Updates: Reflect changes in task statuses across platforms.

### Status Mapping
**Description**: Map Zoho task statuses to Todoist sections or labels for better organization, allowing users to customize status mappings.

**Key Functionalities**:
- Default Mappings: Provide default status mappings.
- Custom Mappings: Users can adjust mappings to fit their workflow.
- Dynamic Updates: Changes in mappings are reflected in subsequent synchronizations.

### Hierarchical Sync
**Description**: Maintain the hierarchy of tasks and subtasks during synchronization, preserving the project structure across platforms.

**Key Functionalities**:
- Parent-Child Relationships: Keep linkage between tasks and their subtasks.
- Nested Tasks Support: Handle multiple levels of task nesting if supported by both platforms.

### Recurring Task Support
**Description**: Handle tasks with start and end dates, reflecting recurring tasks accurately in both systems.

**Key Functionalities**:
- Date Synchronization: Sync start and end dates of tasks.
- Recurring Patterns: Recognize and maintain recurring task patterns.

### User-Friendly Interface
**Description**: Provide a frontend for user configuration and management, integrating the onboarding process into the dashboard.

**Key Functionalities**:
- Integrated Onboarding: Users progress through onboarding steps within the dashboard.
- Feature Unlocking: Each completed onboarding step unlocks the next feature.
- Responsive Design: Built with Tailwind CSS for responsiveness and aesthetics.

### Subscription Management
**Description**: Integrate Stripe for payment processing and subscription handling.

**Key Functionalities**:
- Plan Selection: Users can choose from multiple subscription tiers.
- Payment Processing: Secure handling of payments via Stripe.
- Subscription Management: Allow upgrades, downgrades, and cancellations.

## Onboarding and Dashboard Integration
### Integrated Onboarding Process
The onboarding process is now part of the user dashboard. Each step in the onboarding unlocks access to additional features, encouraging users to complete the setup process.

### Steps and Feature Unlocking
1. **Step 1: Account Verification**
   - Action: User confirms their email address.
   - Unlocks: Access to connect Zoho Projects.

2. **Step 2: Connect Zoho Projects**
   - Action: User authenticates with Zoho via OAuth2.
   - Unlocks: Ability to connect Todoist.

3. **Step 3: Connect Todoist**
   - Action: User authenticates with Todoist via OAuth2.
   - Unlocks: Project selection for synchronization.

4. **Step 4: Select Projects to Sync**
   - Action: User selects projects to synchronize.
   - Unlocks: Customization of synchronization settings.

5. **Step 5: Customize Synchronization Settings**
   - Action: User configures status mappings and sync preferences.
   - Unlocks: Access to manual synchronization and sync status.

6. **Step 6: Subscription Selection**
   - Action: User selects a subscription plan and completes payment.
   - Unlocks: Full synchronization features based on the chosen plan.

### User Interface Integration
- **Dashboard Navigation**: Onboarding steps are accessible from the dashboard, with visual indicators of progress.
- **Feature Availability**: Features in the dashboard are enabled or disabled based on the user's progress in the onboarding process.
- **Guidance and Feedback**: Provide clear instructions and feedback at each step to assist users.

## Subscription Plans and Limitations
### Plan-Based Feature Access
- **Starter Plan**
  - Sync Frequency: Every 24 hours.
  - Features: Basic task synchronization, limited projects and fields, limited manual syncs.

- **Professional Plan**
  - Sync Frequency: Every 6 hours.
  - Features: Includes subtasks and comments, more projects and fields, additional manual syncs.

- **Business Plan**
  - Sync Frequency: Hourly.
  - Features: Advanced field mappings, unlimited projects, priority support.

- **Enterprise Plan**
  - Sync Frequency: Near real-time.
  - Features: All features included, dedicated account manager, early access to new features.

### Upgrade Mechanism
- **In-App Prompts**: Suggest upgrades when users attempt to access features not included in their current plan.
- **Billing Integration**: Secure payment processing through Stripe, with automated plan changes upon successful payment.
- **User Interface**: Clear display of the current plan and benefits of upgrading, integrated within the dashboard.

## Security and Compliance
### Authentication and Authorization
- **User Authentication**: Secure login with email and password, with passwords hashed using bcrypt.
- **OAuth Tokens**: Encrypted using AES-256 before storage, stored with associated metadata.
- **Session Management**: JWTs for session management, with appropriate expiry and refresh mechanisms.

### Data Protection
- **Encryption**: All sensitive data is encrypted at rest and in transit (TLS/SSL).
- **Access Controls**: Implement role-based access control (RBAC) for different user roles.
- **Regular Audits**: Conduct security audits and vulnerability assessments periodically.

### Compliance Standards
- **GDPR**: Provide options for data export and deletion upon user request, and obtain explicit consent for data processing.
- **CCPA**: Allow users to opt-out of data selling and provide disclosures about data collection practices.
- **Other Regulations**: Stay updated on international data protection laws and ensure compliance.

## API Integration Details
### Zoho Projects API
- **Authentication**: OAuth2 with necessary scopes.
- **Endpoints Used**: Projects, tasks, comments, and statuses.
- **Rate Limiting**: Monitor and adhere to Zoho's API rate limits, implement request throttling.

### Todoist API
- **Authentication**: OAuth2 with appropriate scopes.
- **Endpoints Used**: Projects, tasks, labels, and comments.
- **Rate Limiting**: Be aware of Todoist's API limits, handle 429 Too Many Requests responses appropriately.

### Synchronization Logic
- **ID Mappings**: Maintain mappings between Zoho and Todoist IDs for projects, tasks, and comments.
- **Data Comparison**: Fetch data from both APIs and compare to detect changes.
- **Conflict Resolution**: Define rules for handling conflicts (e.g., last modified wins).
- **Error Handling**: Log errors and notify users of synchronization issues.

## User Interface Design
### Design Principles
- **Simplicity**: Keep the interface clean and intuitive.
- **Consistency**: Use consistent design patterns and visual elements.
- **Accessibility**: Ensure usability for users with disabilities.

### Tailwind CSS Framework
- **Purpose**: Utilize Tailwind CSS for rapid, customized design without writing extensive custom CSS.
- **Advantages**: Allows for responsive design, customization, and ensures consistency.
- **Implementation**: Use Tailwind CSS classes directly in HTML templates, customize themes and colors as needed.

### Integrated Onboarding and Dashboard
- **Onboarding Steps**: Integrated within the dashboard, with progress indicators.
- **Feature Unlocking**: Features become available as users complete onboarding steps.
- **Responsive Design**: Ensure the interface works well across devices.

## Testing and Quality Assurance
### Testing Strategies
- **Unit Tests**: Test individual functions and modules using Pytest.
- **Integration Tests**: Verify interactions between frontend and backend components.
- **End-to-End Tests**: Use Selenium or Cypress to simulate user workflows.

### Performance Testing
- **Load Testing**: Simulate multiple users to test scalability.
- **Stress Testing**: Determine system behavior under extreme conditions.

### Security Testing
- **Vulnerability Scanning**: Use tools like OWASP ZAP to detect security flaws.
- **Penetration Testing**: Conduct regular penetration tests to identify and fix vulnerabilities.

## Deployment and Maintenance
### Deployment Strategy
- **Containerization**: Use Docker for consistency across environments.
- **CI/CD**: Implement pipelines for automated testing and deployment.
- **Environments**: Maintain separate development, staging, and production environments.

### Monitoring and Logging
- **Monitoring Tools**: Use services like New Relic or Datadog for real-time monitoring.
- **Logging**: Implement structured logging using Python's logging module.

### Maintenance Plan
- **Regular Updates**: Schedule updates for dependencies and libraries, including Tailwind CSS.
- **Backup Procedures**: Regular backups of the PostgreSQL database.
- **Disaster Recovery**: Have a plan for data restoration and maintaining service continuity.

## Documentation and Support
### User Documentation
- **User Guides**: Step-by-step instructions with screenshots.
- **FAQs**: Address frequently asked questions.
- **Help Resources**: Include help and tooltips within the dashboard.

### Developer Documentation
- **API Documentation**: Document internal APIs and modules.
- **Code Comments and Style Guides**: Maintain readable and maintainable code.

### Support Channels
- **Email Support**: Provide an email address for user inquiries.
- **Knowledge Base**: Create a repository of articles and troubleshooting guides.

## Conclusion
ZTsync offers a streamlined and user-friendly solution for synchronizing tasks between Zoho Projects and Todoist. By simplifying the application architecture, integrating the onboarding process into the dashboard, and focusing on essential features, the application provides an efficient and engaging user experience. The use of Tailwind CSS enhances the visual appeal and responsiveness of the interface. With security, scalability, and compliance in mind, ZTsync is well-positioned to meet the needs of its users and adapt to future requirements.

## Appendices
### Appendix A: Data Models
#### User Model
```python
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    confirmed = db.Column(db.Boolean, default=False)
    subscription_plan = db.Column(db.String(50))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)
```

#### OAuthToken Model
```python
class OAuthToken(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    service = db.Column(db.String(20))  # 'zoho' or 'todoist'
    access_token = db.Column(db.String(256))
    refresh_token = db.Column(db.String(256))
    expires_in = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)
```

#### ProjectMapping Model
```python
class ProjectMapping(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    zoho_project_id = db.Column(db.String(50))
    todoist_project_id = db.Column(db.String(50))
```

#### TaskMapping Model
```python
class TaskMapping(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    zoho_task_id = db.Column(db.String(50))
    todoist_task_id = db.Column(db.String(50))
    parent_task_id = db.Column(db.Integer, db.ForeignKey('taskmapping.id'), nullable=True)
```

#### Subscription Model
```python
class Subscription(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    plan = db.Column(db.String(50))
    status = db.Column(db.String(20))  # 'active', 'canceled', etc.
    stripe_subscription_id = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)
```

### Appendix B: API Endpoints
#### Authentication Routes
- **GET /register**: User registration page.
- **POST /register**: Handles user registration data.
- **GET /login**: User login page.
- **POST /login**: Handles user login.
- **GET /confirm/<token>**: Email confirmation link.

#### OAuth Routes
- **GET /auth/zoho**: Initiates Zoho OAuth flow.
- **GET /auth/zoho/callback**: Handles Zoho OAuth callback.
- **GET /auth/todoist**: Initiates Todoist OAuth flow.
- **GET /auth/todoist/callback**: Handles Todoist OAuth callback.

#### Synchronization Routes
- **POST /sync/manual**: Triggers manual synchronization.
- **GET /sync/status**: Retrieves synchronization status.
- **GET /sync/history**: Retrieves synchronization history.

#### Settings Routes
- **GET /settings**: User settings page.
- **POST /settings**: Updates user settings.

#### Subscription Routes
- **GET /subscribe**: Subscription plan selection.
- **POST /subscribe**: Handles subscription payment processing.
- **POST /billing/webhook**: Handles Stripe webhook events.

### Appendix C: Glossary of Terms
- **Tailwind CSS**: A utility-first CSS framework for building custom designs.
- **OAuth**: Open Authorization protocol for secure API authentication.
- **API**: Application Programming Interface.
- **JWT**: JSON Web Token used for securely transmitting information.
- **ORM**: Object-Relational Mapping.
- **RBAC**: Role-Based Access Control.
- **GDPR**: General Data Protection Regulation.
- **CCPA**: California Consumer Privacy Act.

