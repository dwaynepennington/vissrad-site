VissRad Suite
=============
VissRad, a Suite of Interactive Smart Tools for Project Delivery: every
module, from front-end planning to turnover and maintenance, in one install.
The VissRad Suite icon opens the suite home page; each module also has its own
entry in the Start menu (on a Mac, an app in ~/Applications/VissRad Suite) and
every module has the suite bar across the top to move between them:

    Portfolio and front end   VRPortfolio, VRFEED, VRPreCon
    Estimating                VREST, VRTAR (turnaround estimating)
    Schedule and planning     VRSCH (schedule analysis and editor), VRPlanner
                              (capital work planning) and the specialist
                              planners: data center, E&I, power plant, power
                              outage, upstream, midstream, rail and highway
    Engineering and supply    VRDEng, VRMarkup, VRProCure, VRRFI, VRLink
    Controls and finance      VRPCS, VRCost, VRChange, VRERP, VRARAP, VRBI
    Field execution           VRAWP, VRConstruction, VRSHE, VR4D
    Turnover and operations   VRSU&C (startup and commissioning), VRCMMS
    Assistant                 VRAI

VRTAR and every planner have a Preparation tab: a gated preparation plan,
complexity tier, readiness score, alerts, tie-ins and preparation-team hours
scaled by the project cost.

This package runs on a standalone Windows 10 or 11 computer, or a Mac. It
needs no internet connection, no admin rights and no server: the suite runs
from the installed files. On a Mac it needs Google Chrome or Microsoft Edge
(see INSTALL ON A MAC). It installs beside VRScheduler or VRProject if those
are also installed; each keeps separate records.

By installing VissRad you accept the VissRad End User Licence Agreement
(EULA.txt in this folder).


INSTALL
-------
1. Right-click the VissRad Suite zip file and choose "Extract All...".
2. Open the extracted folder and double-click "Install VissRad Suite".
   If Windows asks whether to run it, choose Run (or More info > Run anyway).
3. Setup copies VissRad Suite to your user folder, puts a VissRad Suite icon on the
   Desktop and a VissRad Suite folder in the Start menu (with an entry for each
   tool), and opens it.

After that, start VissRad Suite from the Desktop icon or the Start menu. The
extracted folder and the zip are no longer needed.


PIN TO THE TASKBAR
------------------
Windows only lets you pin programs yourself; setup cannot do it for you.
Right-click the VissRad Suite icon on the Desktop and choose "Pin to taskbar".
On Windows 11, choose "Show more options" first.


YOUR RECORDS
------------
VissRad Suite opens in its own window (Microsoft Edge, which is part of
Windows, in app mode). Your projects and everything entered for them are kept
on this computer only, in a private profile:

    %LOCALAPPDATA%\VissRad Suite\profile

They are not uploaded anywhere and are not removed when you clear your normal
browser history.

The first time it opens, the suite asks for your project (name, number,
client, site, dates and currency); every module shares it. The Project
dropdown in each module's header switches projects or adds one. Reference
libraries (disciplines, crafts, rates, templates, GL accounts, estimating and
turnaround libraries) are loaded; project records start empty. Enter them in
Data, or import CSV.

File > Save file downloads a backup (.vissrad.json) of a module; on the suite
home page it backs up every module at once. File > Open file puts a backup
back. File > View demo shows the synthetic demonstration project, which does
not describe any real project, client or contractor; Use my data returns.


UPDATE
------
Extract a newer package and run "Install VissRad Suite" again. Your records are
kept.


REMOVE
------
Start menu > VissRad Suite > Uninstall VissRad Suite, or Settings > Apps > Installed
apps > VissRad Suite > Uninstall. You are asked whether to keep your saved records.


INSTALL ON A MAC
----------------
VissRad Suite on a Mac opens in Google Chrome or Microsoft Edge, in its own
window. Install one of them first if the Mac has neither. Safari cannot open
a page in its own window, and the links between the tools need Chrome or Edge.

1. Double-click the zip file. It extracts to a VissRad Suite folder.
2. Open that folder and double-click "Install VissRad Suite (Mac)".
   macOS will say it cannot check the file, because it is not from the App
   Store or a registered developer. To open it anyway:
     - macOS 15 (Sequoia) and later: click Done, open System Settings >
       Privacy & Security, scroll down to the message about
       "Install VissRad Suite (Mac)" and click Open Anyway, then Open.
     - macOS 14 (Sonoma) and earlier: right-click (or Control-click) the
       file, choose Open, then click Open.
   This is asked once, for the installer only.
3. Setup runs in a Terminal window. It copies VissRad Suite to
   ~/Library/Application Support/VissRad Suite, puts an app for each tool and
   Uninstall VissRad Suite in ~/Applications/VissRad Suite, and opens VissRad Suite.
   You can close the Terminal window.

After that, open the tools from Launchpad, Spotlight or the
~/Applications/VissRad Suite folder. To keep VissRad Suite in the Dock, open it, then
right-click its Dock icon > Options > Keep in Dock. Your records are kept in
~/Library/Application Support/VissRad Suite/profile.

To update, run "Install VissRad Suite (Mac)" from a newer zip; your records are
kept. To remove, open ~/Applications/VissRad Suite and double-click
"Uninstall VissRad Suite" (approve it the same way as the installer if asked).


OTHER COMPUTERS
---------------
On a Linux computer, open app/index.html in Google Chrome or Microsoft Edge.
Nothing is installed. The public demonstration is online at
https://vissrad.com/app/


Copyright Pennington Group Associates. All rights reserved.
Fonts: Inter, Montserrat and JetBrains Mono, SIL Open Font Licence
(app/assets/fonts/OFL.txt). Third-party components: THIRD-PARTY-NOTICES.md.
