# Monster Smart Lighting Reverse Engineering Notes

## Overview

This document captures verified findings from reverse engineering the Monster Smart Lighting iOS application and backend services.

The goal is to document API behavior, authentication flows, device models, and property mappings needed for Homebridge integration.

---

## Authentication Flow

### Step 1: Monster Login

The mobile application authenticates against:

```http
POST https://api.monstergen2.bycopilot.com/v4/auth/login
```

Request includes:

```json
{
  "authenticationDetails": {
    "email": "<email>",
    "password": "<password>",
    "applicationId": "MONSTERGEN2"
  }
}
```

Response:

```json
{
  "tokenType": "Bearer",
  "accessToken": "...",
  "refreshToken": "...",
  "expiresIn": 3000
}
```

---
### Step 2: Sphere Token / Session Flow

The Monster access token is used to authenticate with the Sphere backend.

Sphere appears to act as the bridge between Monster identity and Ayla device access.

Observed role:

- validates Monster-authenticated user session
- exposes or brokers downstream Ayla authentication
- ties Monster account identity to Ayla user/device access

Further endpoint details should be documented here once captured.

### Step 3: Ayla Token Exchange

The Monster/Sphere token is exchanged for an Ayla access token.

Endpoint:

```http
POST https://user-field.aylanetworks.com/api/v1/token_sign_in
```

Request:

```json
{
  "token": "<monster token>",
  "app_id": "RGBIC-yQ-id",
  "app_secret": "<secret>"
}
```

Response:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 86400,
  "role": "EndUser",
  "code": "ok"
}
```

---

## Ayla API Authentication

Authenticated Ayla requests use:

```http
Authorization: auth_token <access_token>
x-ayla-source: Mobile
```

Example:

```http
Authorization: auth_token abc123...
```

---

## Device Enumeration

### List Devices

```http
GET https://ads-field.aylanetworks.com/apiv1/devices.json
```

Returns:

```json
[
  {
    "device": {
      "product_name": "Triforce",
      "model": "AY028MCE1",
      "dsn": "AC000W041080075"
    }
  }
]
```

Observed fields:

* product_name
* model
* dsn
* oem_model
* sw_version
* template_id
* mac
* lan_ip
* lan_enabled
* connection_priority
* connection_status

---

## Device Properties

### Read Properties

```http
GET /apiv1/dsns/{dsn}/properties.json
```

Returns all exposed device properties.

---

### Write Property

```http
POST /apiv1/dsns/{dsn}/properties/{property}/datapoints.json
```

Request:

```json
{
  "datapoint": {
    "value": 1
  }
}
```

---

## Verified Property Mappings

### Power

Property:

```text
power
```

Type:

```text
boolean
```

Values:

```text
0 = Off
1 = On
```

HomeKit:

```text
Characteristic.On
```

---

### Brightness

Property:

```text
brightness
```

Type:

```text
integer
```

Observed range:

```text
0-100
```

HomeKit:

```text
Characteristic.Brightness
```

---

### RGB Color

Property:

```text
color_select
```

Type:

```text
integer
```

Format:

```text
0xRRGGBB
```

Examples:

```text
16711680 = 0xFF0000 = Red
255      = 0x0000FF = Blue
```

HomeKit:

```text
Characteristic.Hue
Characteristic.Saturation
```

---

### Color Saturation

Property:

```text
color_saturation
```

Observed range:

```text
0-100
```

HomeKit:

```text
Characteristic.Saturation
```

---

### Color Temperature

Property:

```text
color_temp
```

Observed values:

```text
2   = Warm
100 = Cool
```

HomeKit:

```text
Characteristic.ColorTemperature
```

Mapping logic will be required because HomeKit uses mireds.

---

## Operating Modes

Observed property:

```text
mode
```

Observed value:

```text
static
```

Additional mode investigation required.

---

## Scene Properties

Observed property groups:

```text
st*
dyn*
mus*
diy*
pic*
```

Examples include:

* Rainbow
* Fire
* Confetti
* Halloween
* Peppermint
* Hypnotize
* Vortex
* Pulse

Purpose appears to be:

| Prefix | Meaning              |
| ------ | -------------------- |
| st     | Static Scene         |
| dyn    | Dynamic Effect       |
| mus    | Music Effect         |
| diy    | User Defined         |
| pic    | RGBIC / Pixel Effect |

Further investigation required.

---

## RGBIC Findings

Observed properties:

```text
max_no_of_rgbics
no_of_rgbics
```

Example values:

```text
max_no_of_rgbics = 36
no_of_rgbics = 12
```

Indicates segmented RGBIC support.

Future enhancement.

---

## LAN Communication

Observed device metadata:

```json
{
  "lan_enabled": true,
  "connection_priority": ["LAN"]
}
```

The device appears capable of local communication.

No local control protocol has been reverse engineered yet.

Current plugin scope targets cloud-based Ayla control.

---

## Open Questions

* Exact Sphere token/session endpoint behavior
* Monster refresh-token workflow
* Ayla token refresh workflow
* Scene selection property mapping
* RGBIC segment control
* Local LAN protocol
* Realtime event/update mechanism