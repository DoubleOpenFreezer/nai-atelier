package io.github.helloqun54321.naiatelier;

import android.app.*;
import android.content.*;
import android.os.*;

/** 有限生成／助手任务期间保留前台服务与 CPU 唤醒；任务结束或服务销毁立即释放，不做常驻服务。 */
public class AtelierTaskService extends Service {
    // 后台任务按任务标识计数：等待生成间隔、请求、图片处理与保存都算在该任务全程内。
    static final java.util.Set<String> generationTasks=java.util.concurrent.ConcurrentHashMap.newKeySet();
    static volatile boolean running;
    static int retainJob(String id){if(id!=null&&!id.isEmpty())generationTasks.add(id);return generationTasks.size();}
    static int releaseJob(String id){generationTasks.remove(id);return generationTasks.size();}
    static void clearJobs(){generationTasks.clear();}
    /** 只有后台任务保留期间才需要维持 WebView 的生成调度。 */
    static boolean hasGenerationTasks(){return !generationTasks.isEmpty();}
    PowerManager.WakeLock wakeLock;
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        int tasks=generationTasks.size();
        running=true;
        NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel("atelier-task","创作任务",NotificationManager.IMPORTANCE_LOW));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        startForeground(7,new Notification.Builder(this,"atelier-task").setSmallIcon(R.drawable.ic_stat_work)
            .setContentTitle("NAI Atelier").setContentText(tasks>0?"后台生成任务正在运行（"+tasks+"）":"生成或助手任务正在运行")
            .setContentIntent(open).setOngoing(true).build());
        setWakeLock(tasks>0);
        return START_NOT_STICKY;
    }
    /** 生成间隔与保存图片都不能让 CPU 休眠；唤醒锁只跟随后台任务集合，不跟随服务本身。 */
    void setWakeLock(boolean hold){
        try{
            if(hold){
                if(wakeLock==null){wakeLock=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"NAIAtelier:generation");wakeLock.setReferenceCounted(false);}
                if(!wakeLock.isHeld())wakeLock.acquire();
            }else if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();
        }catch(RuntimeException e){android.util.Log.w("NAIAtelier","任务唤醒锁不可用");}
    }
    @Override public void onDestroy(){clearJobs();setWakeLock(false);running=false;super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onTimeout(int startId,int type){stopSelf();}
}
