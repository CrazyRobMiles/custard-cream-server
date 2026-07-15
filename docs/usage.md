# Using Custard Cream Server from the web

Custard Cream Server hosts the pictures taken by a [custard cream camera](https://github.com/CrazyRobMiles/custard-cream-camera). Everything below needs nothing but a web browser — no account or login is ever required to look at pictures.

## Finding a picture

Every picture uploaded by a camera gets a random three-word phrase, like `oak-larch-feather`. That phrase is the picture's address on the server:

```
http://<server address>/pictures/<phrase>
```

You'll normally arrive at this page one of three ways:

- **Scanning the QR code** the camera shows on its screen right after taking and publishing a photo.
- **Typing the three-word phrase** into the "Find a picture by its three words" box on the server's home page — the camera also displays the phrase alongside its QR code, if you'd rather type it in yourself than scan.
- **Going straight to the URL above** if you already know the phrase.

If the phrase doesn't match any picture, you'll see a "Picture not found" page instead. Consent for publishing a picture is given by the camera operator at the moment they choose to publish it — there's no separate step a viewer needs to take once they find it.

## Browsing random pictures

Visit:

```
http://<server address>/random
```

to see one randomly chosen picture from everyone who's been uploaded. Click **"Show me another"** to see a different one. If nothing's been uploaded yet, the page will tell you there's nothing to show.

## What you can't do without logging in

Posting a new picture (something only the camera itself does) requires a logged-in account with permission to publish. There's no web page for humans to upload pictures through — see [configuration.md](configuration.md) for how the camera itself authenticates.
