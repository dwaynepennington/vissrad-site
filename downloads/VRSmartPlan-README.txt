VRSmartPlan
===========
Estimating, scheduling, planning and project controls workbench from VissRad,
a Suite of Interactive Smart Tools for Project Delivery. Thirteen tools, reached
from the bar under the top bar or from the Start menu (on a Mac, from
~/Applications/VRSmartPlan):

    VRScheduler           CPM schedule editor and Primavera P6 / Microsoft
                          Project schedule analysis (the VRSmartPlan icon opens
                          it)
    VREstimator           drawing takeoff (PDF and DXF), assemblies, crews and
                          EPC estimating; its Schedule tab sends the estimate's
                          schedule to the Schedule Editor or exports a P6 XER
    VRPlanner             capital work planning: step out work items into work
                          steps, crew sizes, craft hours, equipment and materials
    VRDCPlanner           data center construction planning
    VRE&IPlanner          electrical and instrumentation planning
    VRPowerPlanner        power plant construction planning
    VRPowerOutage         power plant outage planning
    VRUpstreamPlanner     upstream oil and gas field development planning
    VRMidstreamPlanner    pipeline and station construction planning
    VRRailHighwayPlanner  rail and heavy highway construction planning
    VRTAR                 turnaround estimating: scope wizard, event fragnet,
                          manpower, materials, progress and adjustments
    VRCMMS                maintenance management: assets, work orders,
                          preventive maintenance, spares and QR asset labels
    VRControls            project controls and cost tracking: work tasks with
                          budget, earned and actual hours, SPI and CPI, the
                          baseline and progress updates from P6 / MS Project,
                          completions (systems, ITRs) and punch

VRTAR and every planner have a Preparation tab: a gated preparation plan timed
back from the event or construction start, complexity tier, readiness score,
overdue alerts, tie-ins, preparation-team hours by role and month (scaled by
the tier and the project cost) and your own past jobs as reference events.
Every tool sends its plan to the Schedule Editor or exports a P6 XER.

In the Schedule Editor, Export > Send to VRControls opens the schedule in
VRControls on Schedule & Baseline: create work tasks and set the baseline from
it, or apply a later version as a progress update (actual and remaining
hours, percent complete). VRControls also reads a P6 XER, P6 XML or MS
Project XML dropped on its window.

This package runs on a standalone Windows 10 or 11 computer, or a Mac. It
needs no internet connection and no admin rights. On a Mac it needs Google
Chrome or Microsoft Edge (see INSTALL ON A MAC). It installs beside VRScheduler
if that is also installed; the two keep separate records.


INSTALL
-------
1. Double-click the VRSmartPlan zip file to open it.
2. Double-click "Install VRSmartPlan". There is no need to extract the zip
   first.
   If Windows asks whether to run it, choose Run (or More info > Run anyway).
3. Setup copies VRSmartPlan to your user folder, puts a VRSmartPlan icon on the
   Desktop and a VRSmartPlan folder in the Start menu (with an entry for each
   tool), and opens it.

After that, start VRSmartPlan from the Desktop icon or the Start menu. The zip
is no longer needed.


PIN TO THE TASKBAR
------------------
Windows only lets you pin programs yourself; setup cannot do it for you.
Right-click the VRSmartPlan icon on the Desktop and choose "Pin to taskbar".
On Windows 11, choose "Show more options" first.


YOUR RECORDS
------------
VRSmartPlan opens in its own window (Microsoft Edge, which is part of Windows,
in app mode). Schedules, estimates, plans, events and controls records are
kept on this computer only, in a private profile:

    %LOCALAPPDATA%\VRSmartPlan\profile

They are not uploaded anywhere and are not removed when you clear your normal
browser history. For a copy you can keep or send, export the schedule (P6
XER, Microsoft Project XML or CSV); in the other tools use File > Save file,
and File > Open file puts a saved file back.

The first time they open, the tools show synthetic sample projects. They do
not describe any real project, client or contractor. Use New project, New
event or (in VRCMMS, on the Dashboard) Start your own site for your own.
VREstimator asks first: start a blank estimate, or explore the demo estimate.


COMING FROM VRPROJECT
---------------------
VRSmartPlan is the new name for VRProject. The first time you install
VRSmartPlan on a computer that has VRProject, setup copies your VRProject
records into VRSmartPlan; VRProject itself is left as it was. When you have
checked your records in VRSmartPlan, remove VRProject from Start menu >
VRProject > Uninstall VRProject (on a Mac, ~/Applications/VRProject >
Uninstall VRProject).

UPDATE
------
Open a newer zip and run "Install VRSmartPlan" again. Your records are
kept.


REMOVE
------
Start menu > VRSmartPlan > Uninstall VRSmartPlan, or Settings > Apps > Installed
apps > VRSmartPlan > Uninstall. You are asked whether to keep your saved
records.


INSTALL ON A MAC
----------------
VRSmartPlan on a Mac opens in Google Chrome or Microsoft Edge, in its own
window. Install one of them first if the Mac has neither. Safari cannot open
a page in its own window, and the links between the tools need Chrome or Edge.

1. Double-click the zip file. macOS extracts it to a folder beside it.
2. Open that folder and double-click "Install VRSmartPlan (Mac)".
   macOS will say it cannot check the file, because it is not from the App
   Store or a registered developer. To open it anyway:
     - macOS 15 (Sequoia) and later: click Done, open System Settings >
       Privacy & Security, scroll down to the message about
       "Install VRSmartPlan (Mac)" and click Open Anyway, then Open.
     - macOS 14 (Sonoma) and earlier: right-click (or Control-click) the
       file, choose Open, then click Open.
   This is asked once, for the installer only.
3. Setup runs in a Terminal window. It copies VRSmartPlan to
   ~/Library/Application Support/VRSmartPlan, puts an app for each tool and
   Uninstall VRSmartPlan in ~/Applications/VRSmartPlan, and opens VRSmartPlan.
   You can close the Terminal window.

After that, open the tools from Launchpad, Spotlight or the
~/Applications/VRSmartPlan folder. To keep VRSmartPlan in the Dock, open it,
then right-click its Dock icon > Options > Keep in Dock. Your records are kept in
~/Library/Application Support/VRSmartPlan/profile.

To update, run "Install VRSmartPlan (Mac)" from a newer zip; your records are
kept. To remove, open ~/Applications/VRSmartPlan and double-click
"Uninstall VRSmartPlan" (approve it the same way as the installer if asked).


OTHER COMPUTERS
---------------
On a Linux computer, open app/index.html in Google Chrome or Microsoft Edge.
Nothing is installed. The same build is online at
https://vissrad.com/VRSmartPlan/


Copyright Pennington Group Associates. All rights reserved.
Fonts: Inter, Montserrat and JetBrains Mono, SIL Open Font Licence
(app/assets/fonts/OFL.txt).
