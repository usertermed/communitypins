# Community Pins

![Build check](https://img.shields.io/github/actions/workflow/status/wdamiens/communitypins/firebase-hosting-merge.yml) ![Made with Firebase](https://img.shields.io/badge/made_with-firebase-orange?logo=firebase) ![Website live?](https://img.shields.io/website?url=https%3A%2F%2Fcommunitypins-89698.web.app%2F&up_message=live&up_color=green&down_message=down&down_color=orange&label=online%3F) ![Made for TSA](https://img.shields.io/badge/made_for-TSA-blue)

Project for 2025 Missouri TSA Website Design.

## Documentation / Technical write-up
### written by Damien

I decided to use Firebase for all of the data storage, authentication, and hosting.

### Data architecture
When a pin is created, an object is created with a server-generated ID (example: 0sqCWvbM080IRdSQ865K), put into the collection **pins**. This object contains latitude, longitude, timestamp, note, first name and user ID.

When a pin object is "hearted", a collection called "hearts" is created (if not already exists) and a heart object (also with a server generated ID) is added to the hearts collection. This object only contains the user ID and timestamp, mainly for analytics reasons.

### Authentication
There was very minimal implementation of any sort of authentication. Infact, the main use for authenticating in the first place is to have the name of who pinned a pin on the pin (say that three times fast). Authentication is handled through Firebase (to maintain simplicity and because Google authentication goes hand-in-hand with Firebase), so I only needed to add a few parts to script.js, and the button to index.html.

### Hosting
This was definitely the easiest part. All I had to do was clone the repository, run ```firebase init:github``` and follow the instructions to get the workflow files for GitHub actions. Now, when anything is commited to `deploy` branch it is automatically deployed on Firebase hosting.